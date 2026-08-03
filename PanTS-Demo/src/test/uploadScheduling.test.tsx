import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/authContext";
import UploadPage from "../routes/UploadPage";

// How a multi-file run is scheduled. Two properties matter and they pull in
// opposite directions, so both are pinned here:
//
//   1. Files upload ONE AT A TIME. Uploading them concurrently doesn't create
//      bandwidth - it just makes every file finish at the same late moment,
//      leaving the GPU idle for the whole upload.
//   2. Each file is dispatched to the server's job queue the instant its OWN
//      upload finishes, NOT after the batch. The server queues behind a
//      one-at-a-time GPU lock, so dispatching early means scan 1 is already
//      segmenting while scan 2 is still going up.

const CHUNK_SIZE = 512 * 1024;
const USER = { id: "u1", email: "test.user@example.com", name: null };

// Comfortably more chunks than the uploader's in-flight concurrency (6), so a
// concurrent schedule would visibly interleave the two files rather than
// happening to drain one before the other.
const CHUNKS_PER_FILE = 10;
const makeFile = (name: string) =>
  new File([new Uint8Array(CHUNK_SIZE * CHUNKS_PER_FILE)], name, {
    type: "application/gzip",
  });

/** Ordered log of the upload-relevant requests, tagged with their session. */
let log: { kind: "chunk" | "finalize" | "infer"; sid: string }[] = [];

const json = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => "",
  headers: { get: () => "application/json" },
});

const sessionOf = (body: unknown): string => {
  if (body instanceof FormData) return String(body.get("session_id"));
  if (body instanceof URLSearchParams) return String(body.get("session_id"));
  return "";
};

beforeEach(() => {
  log = [];
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const sid = sessionOf(init?.body);

    if (u.includes("/api/auth/me")) return json({ user: USER });
    if (u.includes("/api/auth/oauth/providers")) return json({ google: true });

    if (u.includes("/api/upload-inference-chunk")) {
      log.push({ kind: "chunk", sid });
      // A real chunk takes time on the wire. Yielding here means a concurrent
      // scheduler would interleave the two files' chunks and fail the test,
      // rather than passing by accident on instant resolution.
      await new Promise((r) => setTimeout(r, 5));
      return json({ ok: true });
    }
    if (u.includes("/api/finalize-upload")) {
      log.push({ kind: "finalize", sid });
      return json({ uploaded_filename: "ct.nii.gz" });
    }
    if (u.includes("/api/run-epai-inference")) {
      log.push({ kind: "infer", sid });
      return json({ message: "Segmentation started", session_id: sid });
    }
    if (u.includes("/api/inference-status/")) return json({ status: "queued" });

    return json({ items: [], total: 0, ids: [] });
  }) as unknown as typeof fetch;

  localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

const runTwoFiles = async () => {
  const user = userEvent.setup();
  const { container } = render(
    <AuthProvider>
      <MemoryRouter>
        <UploadPage />
      </MemoryRouter>
    </AuthProvider>,
  );
  // Inference requires an account; wait for the session probe to land first.
  await waitFor(() =>
    expect(screen.queryByText(/to run inference on the server/)).not.toBeInTheDocument(),
  );

  const input = container.querySelector<HTMLInputElement>('input[accept=".nii,.gz"]')!;
  await user.upload(input, [makeFile("scan-a.nii.gz"), makeFile("scan-b.nii.gz")]);

  // Default model is "None" (view only, nothing uploads) - pick a real one.
  await user.click(screen.getByRole("button", { name: /None \(view scan\)/ }));
  await user.click(screen.getByText("ePAI"));
  await user.click(screen.getByRole("button", { name: "Run" }));

  await waitFor(
    () => expect(log.filter((e) => e.kind === "infer")).toHaveLength(2),
    { timeout: 5000 },
  );
};

describe("multi-file upload scheduling", () => {
  it("uploads one file at a time instead of interleaving them", async () => {
    await runTwoFiles();

    const chunks = log.filter((e) => e.kind === "chunk");
    expect(chunks).toHaveLength(CHUNKS_PER_FILE * 2);

    // Serialized means the session id changes exactly once across the whole
    // chunk stream; an interleaved schedule would flip back and forth.
    const switches = chunks.filter((e, i) => i > 0 && e.sid !== chunks[i - 1].sid);
    expect(switches).toHaveLength(1);
  });

  it("dispatches each file to the GPU queue before the next file uploads", async () => {
    await runTwoFiles();

    const firstSid = log[0].sid;
    const firstInfer = log.findIndex((e) => e.kind === "infer" && e.sid === firstSid);
    const secondFileStarts = log.findIndex((e) => e.kind === "chunk" && e.sid !== firstSid);

    expect(firstInfer).toBeGreaterThan(-1);
    // The barrier alternative would put both infers at the very end; this
    // asserts scan 1 is already queued for the GPU before scan 2 starts uploading.
    expect(firstInfer).toBeLessThan(secondFileStarts);
  });

  it("gives each file its own session so results don't collide", async () => {
    await runTwoFiles();

    const infers = log.filter((e) => e.kind === "infer").map((e) => e.sid);
    expect(new Set(infers).size).toBe(2);
    // Every file that uploaded also got dispatched - nothing stranded on the
    // server without a job.
    expect(new Set(log.filter((e) => e.kind === "finalize").map((e) => e.sid)))
      .toEqual(new Set(infers));
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/authContext";
import UploadPage from "../routes/UploadPage";

// "pro" so the plan-aware default effect picks "ePAI" once auth resolves,
// same fixture uploadScheduling.test.tsx uses for the same reason - gives a
// deterministic starting point (MODEL_OPTIONS = None, ePAI, Atlas-Net,
// LesionSegmenter) to step the arrows from.
const USER = { id: "u1", email: "test.user@example.com", name: null, plan: "pro" };

const json = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => "",
  headers: { get: () => "application/json" },
});

describe("model info card - prev/next arrows", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/auth/me")) return json({ user: USER });
      if (u.includes("/api/auth/oauth/providers")) return json({ google: true });
      return json({ items: [], total: 0, ids: [] });
    }) as unknown as typeof fetch;
    localStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  const renderPage = async () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <UploadPage />
        </MemoryRouter>
      </AuthProvider>,
    );
    // Wait for the plan-aware default-model effect to land on ePAI.
    await screen.findByText(/Full abdominal organ segmentation/);
  };

  it("steps forward through MODEL_OPTIONS in order, wrapping at the end", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: "Next model" }));
    expect(await screen.findByText(/anatomically consistent/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next model" }));
    expect(await screen.findByText(/fast pancreatic lesion detection/)).toBeInTheDocument();

    // LesionSegmenter -> wraps past the end back to None.
    await user.click(screen.getByRole("button", { name: "Next model" }));
    expect(await screen.findByText(/View only — files never leave your browser/)).toBeInTheDocument();
  });

  it("steps backward, wrapping from the start to the end", async () => {
    const user = userEvent.setup();
    await renderPage();

    // ePAI -> None going back.
    await user.click(screen.getByRole("button", { name: "Previous model" }));
    expect(await screen.findByText(/View only — files never leave your browser/)).toBeInTheDocument();

    // None -> wraps to LesionSegmenter, the last entry.
    await user.click(screen.getByRole("button", { name: "Previous model" }));
    expect(await screen.findByText(/fast pancreatic lesion detection/)).toBeInTheDocument();
  });
});

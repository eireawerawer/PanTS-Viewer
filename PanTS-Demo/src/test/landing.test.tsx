import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/authContext";
import LandingPage from "../routes/LandingPage";
import { LANDING_OVERVIEW, NONCLINICAL_WARNING } from "../helpers/copy";

// The landing page fetches the live CT count; stub it so the test never
// touches a backend (same shape as routes.smoke.test.tsx).
beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ items: [], total: 0, ids: [] }),
    text: async () => "",
    headers: { get: () => "application/json" },
  })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("landing overview paragraph", () => {
  it("sits directly under the subtitle and carries the nonclinical warning", () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </AuthProvider>,
    );
    const subtitle = screen.getByText("The open library of labeled body CT scans");
    const overview = screen.getByText(
      (_, el) =>
        el?.tagName === "P" &&
        (el.textContent ?? "").includes(LANDING_OVERVIEW) &&
        (el.textContent ?? "").includes(NONCLINICAL_WARNING),
    );
    expect(subtitle.nextElementSibling).toBe(overview);
    // Wording rule: nonclinical, not "research only" (users may use masks commercially).
    expect(overview.textContent).not.toMatch(/research use only/i);
    // The stats row still follows.
    expect(screen.getByText("CT Volumes")).toBeInTheDocument();
  });
});

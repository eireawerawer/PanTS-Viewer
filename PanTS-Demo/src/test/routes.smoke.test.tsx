import { render, screen } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthModal from "../components/AuthModal";
import { AuthProvider, useAuth } from "../contexts/authContext";
import AccountPage from "../routes/AccountPage";
import LandingPage from "../routes/LandingPage";
import Homepage from "../routes/Homepage";
import UploadPage from "../routes/UploadPage";

// Smoke tests: each routed page should mount and render its key content without
// crashing. API calls are stubbed so the dashboard's data fetch resolves to an
// empty result set instead of hitting a real backend.
beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ items: [], total: 0, ids: [] }),
    text: async () => "",
    headers: { get: () => "application/json" },
  })) as unknown as typeof fetch;
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Pages now render the account control (useAuth), so every route needs an
// AuthProvider in the tree, not just a router.
const renderRoute = (ui: ReactElement) =>
  render(
    <AuthProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </AuthProvider>,
  );

describe("route smoke tests", () => {
  it("LandingPage (Overview) renders", () => {
    renderRoute(<LandingPage />);
    expect(
      screen.getByText("The open library of labeled body CT scans"),
    ).toBeInTheDocument();
  });

  it("Homepage (Dashboard) renders", async () => {
    renderRoute(<Homepage />);
    expect(await screen.findByText("Browse Library")).toBeInTheDocument();
  });

  it("UploadPage renders", async () => {
    renderRoute(<UploadPage />);
    expect(
      await screen.findByText("Click or drag to upload"),
    ).toBeInTheDocument();
  });

  it("AuthModal opens as a popup with provider options when prompted", async () => {
    const Trigger = () => {
      const { promptAuth } = useAuth();
      useEffect(() => promptAuth("signin"), [promptAuth]);
      return null;
    };
    render(
      <AuthProvider>
        <Trigger />
        <AuthModal />
      </AuthProvider>,
    );
    expect(await screen.findByText("Sign in with Google")).toBeInTheDocument();
    expect(screen.getByText("Sign in with GitHub")).toBeInTheDocument();
  });

  it("AccountPage renders the email-notification setting when signed in", async () => {
    // The session lives in an httponly cookie, so "signed in" means /auth/me
    // answers with a user - not a localStorage key.
    global.fetch = vi.fn(async (url: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes("/api/auth/me")
          ? { user: { id: "u1", email: "test@example.com" } }
          : { items: [], total: 0, ids: [] },
      text: async () => "",
      headers: { get: () => "application/json" },
    })) as unknown as typeof fetch;
    renderRoute(<AccountPage />);
    expect(
      await screen.findByText("Email me when inference finishes"),
    ).toBeInTheDocument();
  });
});

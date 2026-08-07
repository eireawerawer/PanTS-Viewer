import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/authContext";
import SignupPage from "../routes/SignupPage";

// Signing up, at the component level. One screen now: providers, email,
// password, done — no account type, no plan picker, no terms checkbox. A new
// account lands on Free and meets its limits when it reaches them.
//
// Settings has its own suite (accountPage.test.tsx).

const USER = { id: "u1", email: "test@example.com", plan: "free" };

let signedIn = false;
// What the register endpoint received, so the request can be asserted on.
let registeredWith: Record<string, unknown> | null = null;

const jsonResponse = (body: unknown) => ({
	ok: true,
	status: 200,
	json: async () => body,
	text: async () => "",
	headers: { get: () => "application/json" },
});

beforeEach(() => {
	localStorage.clear();
	signedIn = false;
	registeredWith = null;
	global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		if (u.includes("/api/auth/me")) return jsonResponse({ user: signedIn ? USER : null });
		if (u.includes("/api/auth/register") || u.includes("/api/auth/login")) {
			if (u.includes("/register") && init?.body) {
				registeredWith = JSON.parse(String(init.body));
			}
			signedIn = true;
			return jsonResponse({ user: USER });
		}
		if (u.includes("/api/auth/oauth/providers")) return jsonResponse({ google: true, github: true });
		return jsonResponse({ items: [], total: 0, ids: [] });
	}) as unknown as typeof fetch;
});

afterEach(() => {
	vi.restoreAllMocks();
});

const renderAt = (ui: ReactElement, path = "/") =>
	render(
		<AuthProvider>
			<MemoryRouter initialEntries={[path]}>
				<Routes>
					<Route path={path.split("?")[0]} element={ui} />
					<Route path="/upload" element={<div>Upload page</div>} />
					<Route path="/" element={<div>Landing</div>} />
				</Routes>
			</MemoryRouter>
		</AuthProvider>
	);

describe("SignupPage", () => {
	it("creates the account from one screen and goes straight to the app", async () => {
		const user = userEvent.setup();
		renderAt(<SignupPage />, "/signup");

		expect(await screen.findByText("Create your account")).toBeInTheDocument();
		await user.type(screen.getByLabelText(/^Email$/i), "test@example.com");
		await user.type(screen.getByLabelText(/^Password$/i), "hunter2hunter2");
		await user.click(screen.getByRole("button", { name: "Create account" }));

		expect(await screen.findByText("Upload page")).toBeInTheDocument();
		expect(registeredWith).toMatchObject({
			email: "test@example.com", password: "hunter2hunter2",
		});
	});

	it("asks nothing beyond an email and a password", async () => {
		renderAt(<SignupPage />, "/signup");
		await screen.findByText("Create your account");

		// The steps that used to follow are gone, not merely reordered.
		expect(screen.queryByLabelText(/^Name$/i)).not.toBeInTheDocument();
		expect(screen.queryByLabelText(/Confirm password/i)).not.toBeInTheDocument();
		expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/How will you use|Choose a plan/i);
		for (const plan of ["Free", "Pro", "Team", "Enterprise"]) {
			expect(screen.queryByRole("button", { name: plan })).not.toBeInTheDocument();
		}
	});

	it("accepts the terms inline rather than as a step", async () => {
		renderAt(<SignupPage />, "/signup");
		await screen.findByText("Create your account");

		expect(screen.getByText(/By continuing you agree to our/i)).toBeInTheDocument();
		// The links are still there for anyone who wants to read them.
		expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
		expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
	});

	it("offers both providers", async () => {
		renderAt(<SignupPage />, "/signup");
		await screen.findByText("Create your account");

		expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Continue with GitHub/i })).toBeInTheDocument();
	});

	it("disables a provider the server has no credentials for", async () => {
		global.fetch = vi.fn(async (url: RequestInfo | URL) => {
			const u = String(url);
			if (u.includes("/api/auth/me")) return jsonResponse({ user: null });
			if (u.includes("/api/auth/oauth/providers")) return jsonResponse({ google: true, github: false });
			return jsonResponse({});
		}) as unknown as typeof fetch;

		renderAt(<SignupPage />, "/signup");
		await screen.findByText("Create your account");

		await waitFor(() =>
			expect(screen.getByRole("button", { name: /Continue with GitHub/i })).toBeDisabled()
		);
		expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeEnabled();
	});

	it("reports a rejected registration without leaving the page", async () => {
		global.fetch = vi.fn(async (url: RequestInfo | URL) => {
			const u = String(url);
			if (u.includes("/api/auth/me")) return jsonResponse({ user: null });
			if (u.includes("/api/auth/oauth/providers")) return jsonResponse({ google: true, github: false });
			if (u.includes("/api/auth/register")) {
				return {
					ok: false, status: 409,
					json: async () => ({ error: "An account with that email already exists" }),
					text: async () => "",
					headers: { get: () => "application/json" },
				};
			}
			return jsonResponse({});
		}) as unknown as typeof fetch;

		const user = userEvent.setup();
		renderAt(<SignupPage />, "/signup");

		await user.type(await screen.findByLabelText(/^Email$/i), "taken@example.com");
		await user.type(screen.getByLabelText(/^Password$/i), "hunter2hunter2");
		await user.click(screen.getByRole("button", { name: "Create account" }));

		expect(
			await screen.findByText("An account with that email already exists")
		).toBeInTheDocument();
		expect(screen.getByText("Create your account")).toBeInTheDocument();
	});

	it("sends someone who is already signed in to the app", async () => {
		signedIn = true;
		renderAt(<SignupPage />, "/signup");
		await waitFor(() => expect(screen.getByText("Upload page")).toBeInTheDocument());
	});
});

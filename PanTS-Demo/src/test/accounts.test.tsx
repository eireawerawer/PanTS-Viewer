import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../contexts/authContext";
import { loadProfile } from "../helpers/accountProfile";
import SignupPage from "../routes/SignupPage";

// The signup flow end to end at the component level: all four steps, and where
// each answer lands. Account type and plan are a localStorage mock, so asserting
// on storage is the real check; the name is NOT — it goes to the server with the
// registration, so that one is asserted on the request.
//
// The account page has its own suite (accountPage.test.tsx), which exercises the
// real endpoints rather than the mock.

const USER = { id: "u1", email: "test@example.com" };

// /auth/me answers with a user only after `signedIn` flips, so the same stub
// serves both the signed-out signup case and the signed-in account case.
let signedIn = false;
// What the register endpoint actually received, so the name can be asserted on
// the request rather than on local storage.
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
	it("walks all four steps and stores the answers against the user", async () => {
		const user = userEvent.setup();
		renderAt(<SignupPage />, "/signup");

		// Step 1 — credentials.
		expect(await screen.findByText("Create your account")).toBeInTheDocument();
		await user.type(screen.getByLabelText(/^Name$/i), "Ada Lovelace");
		await user.type(screen.getByLabelText(/^Email$/i), "test@example.com");
		await user.type(screen.getByLabelText(/^Password$/i), "hunter2hunter2");
		await user.type(screen.getByLabelText(/Confirm password/i), "hunter2hunter2");
		await user.click(screen.getByRole("button", { name: "Continue" }));

		// Step 2 — account type.
		expect(await screen.findByText("How will you use BodyMaps?")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Clinician" }));
		await user.click(screen.getByRole("button", { name: "Continue" }));

		// Step 3 — plan. No prices anywhere.
		expect(await screen.findByText("Choose a plan")).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(/\$\d/);
		await user.click(screen.getByRole("button", { name: "Pro" }));
		await user.click(screen.getByRole("button", { name: "Continue" }));

		// Step 4 — terms. Finish stays disabled until the box is ticked.
		expect(await screen.findByText("Terms and privacy")).toBeInTheDocument();
		const finish = screen.getByRole("button", { name: "Finish" });
		expect(finish).toBeDisabled();
		await user.click(screen.getByRole("checkbox"));
		expect(finish).toBeEnabled();
		await user.click(finish);

		// Account type and plan are the mock; the name is not — it was sent to
		// /auth/register and lives in user_account.name.
		await waitFor(() => {
			const profile = loadProfile(USER.id);
			expect(profile).toMatchObject({ accountType: "clinician", plan: "pro" });
			expect(profile?.acceptedTermsAt).toBeTruthy();
			expect(profile?.onboardingCompletedAt).toBeTruthy();
		});
		expect(registeredWith).toMatchObject({ email: "test@example.com", name: "Ada Lovelace" });
		expect(loadProfile(USER.id)).not.toHaveProperty("name");
	});

	it("refuses to advance when the passwords don't match", async () => {
		const user = userEvent.setup();
		renderAt(<SignupPage />, "/signup");

		await user.type(await screen.findByLabelText(/^Name$/i), "Ada");
		await user.type(screen.getByLabelText(/^Email$/i), "test@example.com");
		await user.type(screen.getByLabelText(/^Password$/i), "hunter2hunter2");
		await user.type(screen.getByLabelText(/Confirm password/i), "something-else");
		await user.click(screen.getByRole("button", { name: "Continue" }));

		expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
		expect(screen.getByText("Create your account")).toBeInTheDocument();
	});

	it("sends someone with no account back to step 1 even when asked for a later step", async () => {
		// ?step=type is the OAuth entry point; without a session it must not stick.
		renderAt(<SignupPage />, "/signup?step=type");
		expect(await screen.findByText("Create your account")).toBeInTheDocument();
	});
});

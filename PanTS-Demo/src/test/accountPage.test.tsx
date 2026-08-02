import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuthModal from "../components/AuthModal";
import { AuthProvider } from "../contexts/authContext";
import AccountPage from "../routes/AccountPage";

// The account page's four controls against a stubbed API: renaming, export,
// deleting scan history, and deleting the account. Each asserts the request the
// server would actually receive, since that's the contract that matters.

const USER = { id: "u1", email: "test.user@example.com", name: null as string | null };

let calls: { method: string; url: string; body?: unknown }[] = [];

const json = (body: unknown, ok = true, status = 200) => ({
	ok,
	status,
	json: async () => body,
	text: async () => "",
	blob: async () => new Blob([JSON.stringify(body)], { type: "application/json" }),
	headers: { get: () => "application/json" },
});

beforeEach(() => {
	calls = [];
	USER.name = null;
	URL.createObjectURL = vi.fn(() => "blob:stub");
	URL.revokeObjectURL = vi.fn();

	global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
		const u = String(url);
		const method = init?.method ?? "GET";
		calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });

		if (u.includes("/api/auth/me") && method === "PATCH") {
			USER.name = (JSON.parse(String(init?.body)) as { name: string }).name || null;
			return json({ user: { ...USER } });
		}
		if (u.includes("/api/auth/me")) return json({ user: { ...USER } });
		if (u.includes("/api/me/export")) return json({ account: USER, jobs: [] });
		if (u.includes("/api/me/jobs") && method === "DELETE") {
			return json({ deleted: { jobs: 3, files: 5 } });
		}
		if (u.endsWith("/api/me") && method === "DELETE") {
			return json({
				deletion_requested_at: "2026-08-02T00:00:00",
				restore_by: "2026-09-01T00:00:00",
				grace_days: 30,
			});
		}
		if (u.includes("/api/auth/oauth/providers")) return json({ google: true, github: true });
		return json({ items: [], total: 0, ids: [] });
	}) as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

const renderPage = () =>
	render(
		<AuthProvider>
			<MemoryRouter initialEntries={["/account"]}>
				<Routes>
					<Route path="/account" element={<AccountPage />} />
					<Route path="/" element={<div>Landing</div>} />
				</Routes>
			</MemoryRouter>
		</AuthProvider>
	);

const lastCall = (method: string, fragment: string) =>
	[...calls].reverse().find((c) => c.method === method && c.url.includes(fragment));

describe("display name", () => {
	it("falls back to the email and says so when no name is set", async () => {
		renderPage();
		expect(await screen.findByText("Test User")).toBeInTheDocument();
		expect(screen.getByText(/guessed this from your email/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Add name" })).toBeInTheDocument();
	});

	it("saves a new name and stops calling it a guess", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.click(await screen.findByRole("button", { name: "Add name" }));
		await user.type(screen.getByLabelText(/Display name/i), "Ada Lovelace");
		await user.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(lastCall("PATCH", "/api/auth/me")?.body).toEqual({ name: "Ada Lovelace" })
		);
		expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
		expect(screen.queryByText(/guessed this from your email/i)).not.toBeInTheDocument();
	});

	it("surfaces a save failure instead of silently doing nothing", async () => {
		const user = userEvent.setup();
		global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			const u = String(url);
			if (u.includes("/api/auth/me") && init?.method === "PATCH") {
				return json({ error: "Name must be text" }, false, 400);
			}
			if (u.includes("/api/auth/me")) return json({ user: { ...USER } });
			return json({});
		}) as unknown as typeof fetch;

		renderPage();
		await user.click(await screen.findByRole("button", { name: "Add name" }));
		await user.type(screen.getByLabelText(/Display name/i), "x");
		await user.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Name must be text")).toBeInTheDocument();
	});
});

describe("export", () => {
	it("downloads from the server rather than rebuilding from local state", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.click(await screen.findByRole("button", { name: "Export" }));

		await waitFor(() => expect(lastCall("GET", "/api/me/export")).toBeTruthy());
		expect(URL.createObjectURL).toHaveBeenCalled();
		expect(await screen.findByText(/Your data has been downloaded/i)).toBeInTheDocument();
	});

	it("sits outside the danger zone so taking a copy isn't tied to leaving", async () => {
		renderPage();
		const exportBtn = await screen.findByRole("button", { name: "Export" });
		const danger = screen.getByRole("button", { name: "Delete account" }).closest(".account-panel");
		expect(danger?.contains(exportBtn)).toBe(false);
	});
});

describe("delete scan history", () => {
	it("needs CLEAR typed, then reports how many scans went", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.click(await screen.findByRole("button", { name: "Delete history" }));
		const confirm = screen.getByRole("button", { name: "Confirm" });
		expect(confirm).toBeDisabled();
		expect(lastCall("DELETE", "/api/me/jobs")).toBeUndefined();

		await user.type(screen.getByLabelText(/Type CLEAR to confirm/i), "CLEAR");
		await user.click(confirm);

		await waitFor(() => expect(lastCall("DELETE", "/api/me/jobs")).toBeTruthy());
		expect(await screen.findByText(/Deleted 3 scans and their results/i)).toBeInTheDocument();
	});

	it("keeps you signed in", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.click(await screen.findByRole("button", { name: "Delete history" }));
		await user.type(screen.getByLabelText(/Type CLEAR to confirm/i), "CLEAR");
		await user.click(screen.getByRole("button", { name: "Confirm" }));

		await waitFor(() => expect(lastCall("DELETE", "/api/me/jobs")).toBeTruthy());
		expect(screen.getByText("Account")).toBeInTheDocument();
	});
});

describe("delete account", () => {
	it("needs DELETE, not CLEAR", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.click(await screen.findByRole("button", { name: "Delete account" }));
		await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "CLEAR");

		expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
	});

	it("calls the endpoint and leaves the account page once confirmed", async () => {
		const user = userEvent.setup();
		renderPage();

		await user.click(await screen.findByRole("button", { name: "Delete account" }));
		await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
		await user.click(screen.getByRole("button", { name: "Confirm" }));

		await waitFor(() => expect(lastCall("DELETE", "/api/me")).toBeTruthy());
		expect(await screen.findByText("Landing")).toBeInTheDocument();
	});

	it("tells you the deletion is reversible before you confirm", async () => {
		renderPage();
		expect(
			await screen.findByText(/30 days to change your mind/i)
		).toBeInTheDocument();
	});

	it("does not carry a deletion message onto the sign-in popup", async () => {
		const user = userEvent.setup();
		render(
			<AuthProvider>
				<MemoryRouter initialEntries={["/account"]}>
					<Routes>
						<Route path="/account" element={<AccountPage />} />
						<Route path="/" element={<AuthModal />} />
					</Routes>
				</MemoryRouter>
			</AuthProvider>
		);

		await user.click(await screen.findByRole("button", { name: "Delete account" }));
		await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
		await user.click(screen.getByRole("button", { name: "Confirm" }));

		await waitFor(() => expect(lastCall("DELETE", "/api/me")).toBeTruthy());
		expect(screen.queryByText(/scheduled for deletion/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/Sign back in before/i)).not.toBeInTheDocument();
	});
});

describe("success notices", () => {
	it("clear themselves instead of staying pinned to the page", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		renderPage();

		await user.click(await screen.findByRole("button", { name: "Export" }));
		expect(await screen.findByText(/Your data has been downloaded/i)).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(6500);
		await waitFor(() =>
			expect(screen.queryByText(/Your data has been downloaded/i)).not.toBeInTheDocument()
		);
		vi.useRealTimers();
	});

	it("leaves errors up, since those still need acting on", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
			const u = String(url);
			if (u.includes("/api/me/export")) return json({ error: "Storage is offline" }, false, 503);
			if (u.includes("/api/auth/me")) return json({ user: { ...USER } });
			return json({});
		}) as unknown as typeof fetch;

		renderPage();
		await user.click(await screen.findByRole("button", { name: "Export" }));
		expect(await screen.findByText(/Couldn't prepare your data/i)).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(10000);
		expect(screen.getByText(/Couldn't prepare your data/i)).toBeInTheDocument();
		vi.useRealTimers();
	});
});

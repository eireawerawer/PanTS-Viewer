// The two endpoints this dashboard reads. Both 404 unless the server was
// started with ANALYTICS_DASHBOARD=true — that's the expected response, not a
// bug, and the UI says so rather than showing an empty chart.

const API_BASE =
	String(import.meta.env.VITE_API_BASE || "http://localhost:5001").replace(/\/$/, "");

export type Audience = "all" | "signed_in" | "anonymous";

export type Filters = {
	from: string;
	to: string;
	plan: string;
	accountType: string;
	audience: Audience;
};

export type Overview = {
	range: { start: string; end: string };
	totals: {
		events: number;
		people: number;
		sessions: number;
		signed_in_people: number;
		time_ms: number;
	};
	top_actions: { name: string; count: number; people: number }[];
	time_by_route: {
		route: string; views: number; total_ms: number; avg_ms: number; people: number;
	}[];
	by_plan: { plan: string; events: number; people: number }[];
	by_account_type: { account_type: string; events: number; people: number }[];
	daily: { day: string; events: number; people: number }[];
};

export type Meta = {
	plans: string[];
	account_types: string[];
	audiences: Audience[];
};

/** Thrown when the server is up but the dashboard endpoints are switched off. */
export class DashboardDisabled extends Error {}

const get = async <T,>(path: string): Promise<T> => {
	let res: Response;
	try {
		res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
	} catch {
		throw new Error(`Can't reach the API at ${API_BASE}. Is flask-server running?`);
	}
	if (res.status === 404) {
		throw new DashboardDisabled(
			"The analytics endpoints are switched off. Restart flask-server with ANALYTICS_DASHBOARD=true."
		);
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error || `Request failed (${res.status}).`);
	}
	return res.json() as Promise<T>;
};

export const fetchMeta = () => get<Meta>("/api/analytics/meta");

export const fetchOverview = (f: Filters) => {
	const params = new URLSearchParams({ from: f.from, to: f.to, audience: f.audience });
	if (f.plan) params.set("plan", f.plan);
	if (f.accountType) params.set("account_type", f.accountType);
	return get<Overview>(`/api/analytics/overview?${params}`);
};

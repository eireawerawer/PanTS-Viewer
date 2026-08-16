// The two endpoints the usage dashboard reads.
//
// Both need the server started with ANALYTICS_DASHBOARD=true *and* an admin
// session. Those two refusals are different things and the page says so
// differently: a 404 is "this deploy doesn't serve analytics at all", a 403 is
// "you're signed in and this isn't yours". Neither is a bug to retry.

import { API_BASE } from "../../../helpers/constants";

export type Audience = "all" | "signed_in" | "anonymous";

export type Filters = {
	from: string;
	to: string;
	plan: string;
	accountType: string;
	audience: Audience;
	/** "Ever": ignores from/to and starts at the oldest event on record. */
	allTime: boolean;
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
	/** Every action the server will store. The ones missing from top_actions are
	 *  exactly the features nobody has used — which is half the question. */
	action_names: string[];
	routes: string[];
};

/** The server is up but this deploy doesn't serve the dashboard endpoints. */
export class DashboardDisabled extends Error {}
/** Signed in, but not an admin. */
export class DashboardForbidden extends Error {}

const get = async <T,>(path: string): Promise<T> => {
	let res: Response;
	try {
		res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
	} catch {
		throw new Error("Can't reach the API. Is the server running?");
	}
	if (res.status === 404) {
		throw new DashboardDisabled(
			"This server isn't serving analytics. It needs to be started with ANALYTICS_DASHBOARD=true."
		);
	}
	if (res.status === 401 || res.status === 403) {
		throw new DashboardForbidden("You need an admin account to see usage data.");
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(body.error || `Request failed (${res.status}).`);
	}
	return res.json() as Promise<T>;
};

export const fetchMeta = () => get<Meta>("/api/analytics/meta");

export const fetchOverview = (f: Filters) => {
	const params = new URLSearchParams({ audience: f.audience });
	if (f.allTime) params.set("range", "all");
	else {
		params.set("from", f.from);
		params.set("to", f.to);
	}
	if (f.plan) params.set("plan", f.plan);
	if (f.accountType) params.set("account_type", f.accountType);
	return get<Overview>(`/api/analytics/overview?${params}`);
};

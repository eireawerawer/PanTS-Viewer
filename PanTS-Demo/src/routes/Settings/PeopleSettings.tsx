import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../contexts/authContext";
import { API_BASE } from "../../helpers/constants";
import { track } from "../../helpers/analytics";
import { useSettings } from "./context";
import { titleCase } from "./analytics/format";
import "./analytics/dashboard.css";

// People: every account, and the roles they hold.
//
// Admin-only, checked here as well as on the server — the settings nav hides the
// link for everyone else, but a hidden link is not access control.
//
// The two roles do very different things and the page says so, because
// "annotator" currently grants nothing: it marks who *will* be able to edit
// segmentation masks once that exists. Promising access this page can't yet
// deliver is worse than saying it plainly.

type Person = {
	id: string;
	email: string;
	name: string | null;
	plan: string;
	account_type: string | null;
	created_at: string | null;
	roles: string[];
};

const ROLE_BLURB: Record<string, string> = {
	admin: "Sees usage and manages roles",
	annotator: "Will be able to edit scans (not wired up yet)",
};

const joined = (iso: string | null) => {
	if (!iso) return "";
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ""
		: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const PeopleSettings: React.FC = () => {
	const { user } = useAuth();
	const { fail, notify } = useSettings();
	const isAdmin = !!user?.roles.includes("admin");

	const [query, setQuery] = useState("");
	const [people, setPeople] = useState<Person[]>([]);
	const [roles, setRoles] = useState<string[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// The row being changed, so only its toggles go dead rather than the page.
	const [pending, setPending] = useState<string | null>(null);

	const load = useCallback(async (q: string) => {
		setLoading(true);
		setError(null);
		try {
			const params = new URLSearchParams();
			if (q.trim()) params.set("q", q.trim());
			const res = await fetch(`${API_BASE}/api/admin/people?${params}`, {
				credentials: "include",
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error || `Couldn't load accounts (${res.status}).`);
			}
			const body = await res.json();
			setPeople(body.people);
			setRoles(body.roles);
			setTotal(body.total);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't load accounts.");
			setPeople([]);
		} finally {
			setLoading(false);
		}
	}, []);

	// Debounced so typing an email doesn't fire a request per keystroke.
	useEffect(() => {
		if (!isAdmin) return;
		const t = setTimeout(() => load(query), 250);
		return () => clearTimeout(t);
	}, [isAdmin, query, load]);

	const toggle = async (person: Person, role: string, held: boolean) => {
		setPending(person.id);
		try {
			const res = await fetch(
				held
					? `${API_BASE}/api/admin/people/${person.id}/roles/${role}`
					: `${API_BASE}/api/admin/people/${person.id}/roles`,
				{
					method: held ? "DELETE" : "POST",
					credentials: "include",
					headers: held ? undefined : { "Content-Type": "application/json" },
					body: held ? undefined : JSON.stringify({ role }),
				},
			);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error || "That didn't work.");

			// Trust the server's list rather than assuming the toggle took: it
			// refuses some revokes, and this is the row that has to show it.
			setPeople((current) =>
				current.map((p) => (p.id === person.id ? { ...p, roles: body.roles } : p)));
			track(held ? "admin_revoke_role" : "admin_grant_role");
			notify(
				held
					? `Removed ${role} from ${person.email}.`
					: `${person.email} is now an ${role}.`,
			);
		} catch (e) {
			fail(e instanceof Error ? e.message : "That didn't work.");
		} finally {
			setPending(null);
		}
	};

	if (!isAdmin) {
		return (
			<div className="set-group">
				<h2 className="set-heading">People</h2>
				<p className="set-sub">You need an admin account to see this.</p>
			</div>
		);
	}

	return (
		<div className="dash">
			<div className="set-group">
				<h2 className="set-heading">People</h2>
				<p className="set-sub">
					Every account, and what it can do. Admins see usage and manage roles.
					Annotators will be able to edit and create segmentation masks — the role
					can be granted now, but nothing reads it yet.
				</p>

				<input
					type="search"
					className="set-input"
					placeholder="Search by email or name"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					aria-label="Search accounts"
				/>
			</div>

			{error && <div className="set-banner set-banner--error dash-banner">{error}</div>}

			{loading && !people.length && <p className="dash-empty">Loading…</p>}

			{!loading && !people.length && !error && (
				<p className="dash-empty">
					{query ? `No account matches "${query}".` : "No accounts yet."}
				</p>
			)}

			{people.map((person) => (
				<div className="set-row dash-person" key={person.id}>
					<span className="set-row-label">
						{person.email}
						{person.id === user?.id && <span className="dash-you"> you</span>}
						<span className="set-row-note">
							{[person.name, titleCase(person.plan), joined(person.created_at)]
								.filter(Boolean)
								.join(" · ")}
						</span>
					</span>
					<span className="dash-roles">
						{roles.map((role) => {
							const held = person.roles.includes(role);
							return (
								<button
									key={role}
									type="button"
									className={`set-segmented-btn dash-role${held ? " set-segmented-btn--on" : ""}`}
									aria-pressed={held}
									// Without the email, every row's toggles are announced
									// identically — a screen reader hears "admin" a dozen
									// times with no way to tell whose it is.
									aria-label={`${role} — ${person.email}`}
									title={ROLE_BLURB[role]}
									disabled={pending === person.id}
									onClick={() => toggle(person, role, held)}
								>
									{role}
								</button>
							);
						})}
					</span>
				</div>
			))}

			{total > people.length && (
				<p className="dash-empty">
					Showing {people.length} of {total}. Search to narrow it down.
				</p>
			)}
		</div>
	);
};

export default PeopleSettings;

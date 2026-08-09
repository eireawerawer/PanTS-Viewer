import { useCallback, useEffect, useState } from "react";
import {
	DashboardDisabled, fetchMeta, fetchOverview,
	type Audience, type Filters, type Meta, type Overview,
} from "./api";
import BarList, { type Bar } from "./components/BarList";
import TrendLine from "./components/TrendLine";
import { count, dateInput, duration, eventArea, eventLabel } from "./format";

// The whole dashboard: one filter row, one set of panels, one request.
//
// Every panel is drawn from a single /analytics/overview response so they can
// never disagree with each other mid-change. The layout borrows the main site's
// settings chrome (set-* classes, imported from its own stylesheet) — this is an
// internal tool and it should look like the product, not like a second product.

const DEFAULT_FILTERS: Filters = {
	from: dateInput(29),
	to: dateInput(0),
	plan: "",
	accountType: "",
	audience: "all",
};

const AUDIENCE_LABELS: Record<Audience, string> = {
	all: "Everyone",
	signed_in: "Signed in",
	anonymous: "Signed out",
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const App: React.FC = () => {
	const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
	const [meta, setMeta] = useState<Meta | null>(null);
	const [data, setData] = useState<Overview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [disabled, setDisabled] = useState(false);
	const [loading, setLoading] = useState(true);

	const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
		setFilters((f) => ({ ...f, [key]: value }));

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [m, o] = await Promise.all([fetchMeta(), fetchOverview(filters)]);
			setMeta(m);
			setData(o);
			setDisabled(false);
		} catch (e) {
			if (e instanceof DashboardDisabled) setDisabled(true);
			setError(e instanceof Error ? e.message : "Something went wrong.");
			setData(null);
		} finally {
			setLoading(false);
		}
	}, [filters]);

	useEffect(() => {
		load();
	}, [load]);

	const totals = data?.totals;

	// Time is reported per route, and a route is how a feature is reached — so
	// this is "where the time goes", which is the question actually being asked.
	const timeBars: Bar[] = (data?.time_by_route ?? []).map((r) => ({
		label: r.route,
		value: r.total_ms,
		display: duration(r.total_ms),
		note: `${count(r.views)} ${r.views === 1 ? "visit" : "visits"} · ${duration(r.avg_ms)} avg`,
		title: `${r.route}: ${duration(r.total_ms)} across ${count(r.views)} visits by ${count(r.people)} people`,
	}));

	const actionBars: Bar[] = (data?.top_actions ?? []).map((a) => ({
		label: eventLabel(a.name),
		value: a.count,
		note: `${titleCase(eventArea(a.name))} · ${count(a.people)} ${a.people === 1 ? "person" : "people"}`,
		title: `${a.name} — ${count(a.count)} times by ${count(a.people)} people`,
	}));

	const planBars: Bar[] = (data?.by_plan ?? []).map((p) => ({
		label: titleCase(p.plan),
		value: p.events,
		note: `${count(p.people)} ${p.people === 1 ? "person" : "people"}`,
	}));

	const typeBars: Bar[] = (data?.by_account_type ?? []).map((t) => ({
		label: titleCase(t.account_type),
		value: t.events,
		note: `${count(t.people)} ${t.people === 1 ? "person" : "people"}`,
	}));

	return (
		<div className="set-wrapper">
			<main className="set-main dash-main">
				<header className="dash-header">
					<h1 className="set-title dash-title">Usage</h1>
					<p className="set-sub">
						What people do in BodyMaps, and how long they spend doing it. Internal
						and local only — see <code>analytics/README.md</code>.
					</p>
				</header>

				{/* Filters sit in one row above everything they affect. */}
				<div className="dash-filters">
					<label className="dash-field">
						<span className="dash-field-label">From</span>
						<input
							type="date" className="set-input dash-input"
							value={filters.from} max={filters.to}
							onChange={(e) => set("from", e.target.value)}
						/>
					</label>
					<label className="dash-field">
						<span className="dash-field-label">To</span>
						<input
							type="date" className="set-input dash-input"
							value={filters.to} min={filters.from} max={dateInput(0)}
							onChange={(e) => set("to", e.target.value)}
						/>
					</label>
					<label className="dash-field">
						<span className="dash-field-label">Plan</span>
						<select
							className="set-select dash-input" value={filters.plan}
							onChange={(e) => set("plan", e.target.value)}
						>
							<option value="">All plans</option>
							{(meta?.plans ?? []).map((p) => (
								<option key={p} value={p}>{titleCase(p)}</option>
							))}
						</select>
					</label>
					<label className="dash-field">
						<span className="dash-field-label">Account type</span>
						<select
							className="set-select dash-input" value={filters.accountType}
							onChange={(e) => set("accountType", e.target.value)}
						>
							<option value="">All types</option>
							{(meta?.account_types ?? []).map((t) => (
								<option key={t} value={t}>{titleCase(t)}</option>
							))}
						</select>
					</label>
					<label className="dash-field">
						<span className="dash-field-label">Audience</span>
						<select
							className="set-select dash-input" value={filters.audience}
							onChange={(e) => set("audience", e.target.value as Audience)}
						>
							{(meta?.audiences ?? (["all", "signed_in", "anonymous"] as Audience[])).map((a) => (
								<option key={a} value={a}>{AUDIENCE_LABELS[a] ?? a}</option>
							))}
						</select>
					</label>
					{(filters.plan || filters.accountType || filters.audience !== "all") && (
						<button
							type="button" className="set-btn dash-reset"
							onClick={() => setFilters((f) => ({
								...f, plan: "", accountType: "", audience: "all",
							}))}
						>
							Clear filters
						</button>
					)}
				</div>

				{disabled && (
					<div className="set-banner set-banner--error dash-banner">
						{error}
					</div>
				)}
				{error && !disabled && (
					<div className="set-banner set-banner--error dash-banner">
						{error}{" "}
						<button type="button" className="dash-retry" onClick={load}>Try again</button>
					</div>
				)}

				{loading && !data && <p className="dash-empty">Loading…</p>}

				{data && (
					<>
						<div className="dash-tiles">
							<Tile label="Events" value={count(totals!.events)} />
							<Tile
								label="People"
								value={count(totals!.people)}
								note={`${count(totals!.signed_in_people)} signed in`}
							/>
							<Tile label="Visits" value={count(totals!.sessions)} />
							<Tile label="Time in app" value={duration(totals!.time_ms)} />
						</div>

						<section className="set-panel dash-panel">
							<h2 className="set-heading">Activity</h2>
							<p className="set-sub">Events per day across the selected range.</p>
							<TrendLine points={data.daily} />
						</section>

						<section className="set-panel dash-panel">
							<h2 className="set-heading">Most-used features</h2>
							<p className="set-sub">
								Every tracked action, most frequent first. Counted per event, with
								the number of distinct people beside it — one person clicking forty
								times is not forty people.
							</p>
							<BarList bars={actionBars} empty="No actions recorded in this range." />
						</section>

						<section className="set-panel dash-panel">
							<h2 className="set-heading">Where the time goes</h2>
							<p className="set-sub">
								Total time on each route, counted only while the tab was in front.
							</p>
							<BarList bars={timeBars} empty="No page views recorded in this range." />
						</section>

						<div className="dash-split">
							<section className="set-panel dash-panel">
								<h2 className="set-heading">By plan</h2>
								<p className="set-sub">
									The plan each person was on when the event was recorded.
								</p>
								<BarList bars={planBars} />
							</section>

							<section className="set-panel dash-panel">
								<h2 className="set-heading">By account type</h2>
								<p className="set-sub">
									Self-reported. "Not set" is a signed-in user who never chose one.
								</p>
								<BarList bars={typeBars} />
							</section>
						</div>
					</>
				)}
			</main>
		</div>
	);
};

const Tile: React.FC<{ label: string; value: string; note?: string }> = ({
	label, value, note,
}) => (
	<div className="dash-tile">
		<span className="dash-tile-label">{label}</span>
		<span className="dash-tile-value">{value}</span>
		{note && <span className="dash-tile-note">{note}</span>}
	</div>
);

export default App;

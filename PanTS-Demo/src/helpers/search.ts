// Helpers for the dashboard's advanced search against the backend /api/search.
// Extracted from Homepage so the query-building and id-parsing can be unit-tested.

export type TumorFilter = "any" | "tumor" | "no_tumor";

export type SearchFilters = {
	tumor: TumorFilter;
	sex: string[]; // M / F / UNKNOWN
	age: string[]; // "0-9" … "90-99" / "UNKNOWN"
	manufacturer: string[]; // scanner manufacturer (from facets)
	ctPhase: string[]; // CT phase, e.g. Arterial (from facets)
	siteNat: string[]; // site nationality, e.g. US (from facets)
	year: string[]; // study year (from facets)
	dataset: string[]; // "PanTS" / "CancerVerse" (from facets)
};

export const EMPTY_FILTERS: SearchFilters = {
	tumor: "any",
	sex: [],
	age: [],
	manufacturer: [],
	ctPhase: [],
	siteNat: [],
	year: [],
	dataset: [],
};

// The multi-select array keys (everything except `tumor`).
export type MultiFilterKey = "sex" | "age" | "manufacturer" | "ctPhase" | "siteNat" | "year" | "dataset";

// Minimal shape of an item returned by /api/search and /api/random.
export type SearchItem = {
	case_id?: string | number;
	"PanTS ID"?: string | number;
	id?: string | number;
	dataset?: "PanTS" | "CancerVerse";
	tumor?: number | null;
	sex?: string | null;
	age?: number | string | null;
};

// Case identity as a string, e.g. "PanTS_00008854" -> "8854" (PanTS's existing bare-
// number id, unchanged) or "CV_00000012" -> "CV_00000012" (CancerVerse's real id,
// kept as-is — no offset/renumbering, so it stays identical to the folder name on
// disk). Returns "0" when nothing usable is present.
export const itemToId = (it: SearchItem): string => {
	const raw = String(it.case_id ?? it["PanTS ID"] ?? it.id ?? "");
	if (/^cv_?\d+$/i.test(raw.trim())) return raw.trim().toUpperCase();
	const m = raw.match(/\d+/);
	return m ? String(Number(m[0])) : "0";
};

// Build the /api/search (and /api/facets, and URL) query string from the active
// filters. Mirrors the backend params accepted by apply_filters: sex[]/age_bin[]/
// manufacturer[]/ct_phase[]/site_nat[]/year[] (multi), tumor (1/0, omitted for "any"),
// plus optional sort_by / per_page.
export const buildSearchParams = (
	filters: SearchFilters,
	opts: { sortBy?: string; perPage?: number } = {}
): URLSearchParams => {
	const params = new URLSearchParams();
	filters.sex.forEach((v) => params.append("sex[]", v));
	if (filters.tumor === "tumor") params.set("tumor", "1");
	else if (filters.tumor === "no_tumor") params.set("tumor", "0");
	filters.age.forEach((v) => params.append("age_bin[]", v));
	(filters.manufacturer ?? []).forEach((v) => params.append("manufacturer[]", v));
	(filters.ctPhase ?? []).forEach((v) => params.append("ct_phase[]", v));
	(filters.siteNat ?? []).forEach((v) => params.append("site_nat[]", v));
	(filters.year ?? []).forEach((v) => params.append("year[]", v));
	(filters.dataset ?? []).forEach((v) => params.append("dataset[]", v));
	if (opts.sortBy) params.set("sort_by", opts.sortBy);
	if (opts.perPage) params.set("per_page", String(opts.perPage));
	return params;
};

// Reconstruct filters from a URL query string — the inverse of buildSearchParams,
// so a shared/bookmarked link restores the same filtered cohort.
export const parseFiltersFromParams = (params: URLSearchParams): SearchFilters => {
	const tumorRaw = params.get("tumor");
	const tumor: TumorFilter = tumorRaw === "1" ? "tumor" : tumorRaw === "0" ? "no_tumor" : "any";
	return {
		tumor,
		sex: params.getAll("sex[]"),
		age: params.getAll("age_bin[]"),
		manufacturer: params.getAll("manufacturer[]"),
		ctPhase: params.getAll("ct_phase[]"),
		siteNat: params.getAll("site_nat[]"),
		year: params.getAll("year[]"),
		dataset: params.getAll("dataset[]"),
	};
};

export const countActiveFilters = (f: SearchFilters): number =>
	(f.tumor !== "any" ? 1 : 0) +
	f.sex.length +
	f.age.length +
	f.manufacturer.length +
	f.ctPhase.length +
	f.siteNat.length +
	f.year.length +
	f.dataset.length;

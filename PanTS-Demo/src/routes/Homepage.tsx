import {
  IconAdjustmentsHorizontal,
  IconArrowsShuffle,
  IconBookmark,
  IconChevronDown,
  IconDatabase,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import Preview from "../components/Preview";
import styles from "./Homepage.module.css";
import { API_BASE } from "../helpers/constants";
import {
  buildSearchParams,
  type CaseId,
  countActiveFilters,
  EMPTY_FILTERS,
  itemToId,
  type MultiFilterKey,
  parseFiltersFromParams,
  type SearchFilters as Filters,
  type SearchItem,
  type TumorFilter,
} from "../helpers/search";
import { prefetchViewer } from "../helpers/prefetchViewer";
import {
  loadSavedCases,
  SAVED_CASES_EVENT,
  type SavedCase,
  toggleSavedCase,
} from "../helpers/savedCases";
import type { PreviewType } from "../types";

// Live facet counts from /api/facets (conditioned on the current filters).
type FacetRow = { value: string | number; label?: string; count: number };
type FacetData = {
  counts: Record<string, FacetRow[]>;
  unknown: Record<string, number>;
  total: number;
  datasetCounts: Record<string, number>;
};

// Filter groups whose available values are discovered from /api/facets (not hardcoded).
const FACET_GROUPS: { key: MultiFilterKey; field: string; title: string }[] = [
  { key: "manufacturer", field: "manufacturer", title: "Manufacturer" },
  { key: "ctPhase", field: "ct_phase", title: "CT Phase" },
  { key: "siteNat", field: "site_nat", title: "Site" },
  { key: "year", field: "year", title: "Study Year" },
];

// Number of cards in the curated landing strip (and skeleton placeholders).
const CARD_COUNT = 8;
// Page size when browsing/paging through search or filtered results.
// 4 columns × 4 rows = 16 cards per page.
const PER_PAGE = 16;

const TUMOR_OPTIONS: { value: TumorFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "tumor", label: "Tumor" },
  { value: "no_tumor", label: "No tumor" },
];

// Which dataset(s) to search. Empty = both (backend ?dataset=all). CancerVerse is
// CT-only (no masks yet), so those cases sort after the mask-complete PanTS cases.
const DATASET_OPTIONS = [
  { value: "PanTS", label: "PanTS" },
  { value: "CancerVerse", label: "CancerVerse" },
];

// Values match the backend /api/search params: sex -> M/F/UNKNOWN, age -> age_bin[].
const SEX_OPTIONS = [
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
  { value: "UNKNOWN", label: "Unknown" },
];

const AGE_OPTIONS = [
  { value: "0-9", label: "0-9" },
  { value: "10-19", label: "10-19" },
  { value: "20-29", label: "20-29" },
  { value: "30-39", label: "30-39" },
  { value: "40-49", label: "40-49" },
  { value: "50-59", label: "50-59" },
  { value: "60-69", label: "60-69" },
  { value: "70-79", label: "70-79" },
  { value: "80-89", label: "80-89" },
  { value: "90-99", label: "90-99" },
  { value: "UNKNOWN", label: "Unknown" },
];

const pillClass = (active: boolean) =>
  `${styles.pill} ${active ? styles.pillActive : ""}`;

const pagerBtnClass = (disabled: boolean) =>
  `${styles.pagerBtn} ${disabled ? styles.pagerBtnDisabled : ""}`;

export default function Homepage() {
  const [PREVIEW_IDS, SET_PREVIEW_IDS] = useState<CaseId[]>([]);
  const navigation = useNavigate();
  const [previewMetadata, setPreviewMetadata] = useState<{
    [key: string]: PreviewType;
  }>({});
  const [loading, setLoading] = useState(true);
  const [searchId, setSearchId] = useState<number>(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(() =>
    parseFiltersFromParams(searchParams),
  );
  const [facetData, setFacetData] = useState<FacetData | null>(null);
  const [matchTotal, setMatchTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [resultCount, setResultCount] = useState<number | null>(null);

  // Bookmarked cases (localStorage). `showSaved` swaps the grid to show only these.
  const [savedCases, setSavedCases] = useState<SavedCase[]>(loadSavedCases);
  const [showSaved, setShowSaved] = useState(false);
  const savedIds = new Set(savedCases.map((c) => c.id));

  // Keep in sync when a bookmark is toggled here or in another tab.
  useEffect(() => {
    const refresh = () => setSavedCases(loadSavedCases());
    window.addEventListener(SAVED_CASES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SAVED_CASES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const handleToggleSave = (id: CaseId, meta?: PreviewType) => {
    const m = meta ?? previewMetadata[id];
    toggleSavedCase({
      id,
      sex: m?.sex ?? "",
      age: m?.age ?? 0,
      tumor: m?.tumor ?? 0,
    });
  };

  // Cases picked for side-by-side comparison (max 2). Adding a third drops the oldest,
  // so the two most recent picks are always what get compared.
  const [compareIds, setCompareIds] = useState<CaseId[]>([]);
  const [compareTyped, setCompareTyped] = useState("");
  const toggleCompare = (id: CaseId) => {
    setCompareIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id].slice(-2),
    );
  };
  // Add a case by id typed into the tray (idempotent; caps at the two most recent).
  const addCompareId = (id: CaseId) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev : [...prev, id].slice(-2),
    );
  };
  const submitTypedCompare = () => {
    const raw = compareTyped.trim();
    if (raw.toUpperCase().startsWith("CV")) {
      addCompareId(raw); // CancerVerse id typed in full
    } else {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) addCompareId(n);
    }
    setCompareTyped("");
  };

  // Turn /api/search (or /api/random) items into the ids + metadata the grid needs.
  const ingestItems = (items: SearchItem[]) => {
    const ids: CaseId[] = [];
    const meta: { [key: string]: PreviewType } = {};
    for (const it of items) {
      const id = itemToId(it);
      if (!id) continue;
      ids.push(id);
      meta[id] = {
        sex: it.sex ?? "",
        age: Number(it.age) || 0,
        tumor: it.tumor === 1 ? 1 : 0,
      };
    }
    setPreviewMetadata(meta);
    SET_PREVIEW_IDS(ids);
    setLoading(false);
  };

  // Curated cases = the fullest-body scans (sort_by=shape_desc = largest image
  // dimensions / most anatomy covered), split half tumor / half no-tumor and
  // interleaved so the grid is balanced. Uses the existing /api/search endpoint
  // with its built-in sort — no hardcoded ids.
  const loadCurated = async () => {
    setLoading(true);
    setPreviewMetadata({});
    const half = CARD_COUNT / 2;
    try {
      const okJson = (r: Response) => {
        if (!r.ok) throw new Error(`Curated load failed (${r.status})`);
        return r.json();
      };
      const [tumorRes, noTumorRes] = await Promise.all([
        fetch(
          `${API_BASE}/api/search?tumor=1&sort_by=shape_desc&per_page=${half}`,
        ).then(okJson),
        fetch(
          `${API_BASE}/api/search?tumor=0&sort_by=shape_desc&per_page=${half}`,
        ).then(okJson),
      ]);
      const tumorItems: SearchItem[] = tumorRes.items ?? [];
      const noTumorItems: SearchItem[] = noTumorRes.items ?? [];
      const interleaved: SearchItem[] = [];
      for (
        let i = 0;
        i < Math.max(tumorItems.length, noTumorItems.length);
        i++
      ) {
        if (tumorItems[i]) interleaved.push(tumorItems[i]);
        if (noTumorItems[i]) interleaved.push(noTumorItems[i]);
      }
      ingestItems(interleaved);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  // Run /api/search for the given filters + page and populate the grid. The matched
  // cohort can be any size (up to the full ~9.9k), but we only ever fetch/render one
  // PER_PAGE page at a time, so the DOM/thumbnail load stays bounded.
  const runSearch = async (f: Filters, p = 1) => {
    setLoading(true);
    setPreviewMetadata({});
    try {
      const params = buildSearchParams(f, {
        sortBy: "quality",
        perPage: PER_PAGE,
      });
      params.set("page", String(p));
      const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      setResultCount(data.total ?? 0);
      setPage(data.page ?? p);
      ingestItems(data.items ?? []);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  // Jump to a page of the current cohort and scroll the grid back into view.
  const goToPage = (p: number) => {
    const pages = resultCount
      ? Math.max(1, Math.ceil(resultCount / PER_PAGE))
      : 1;
    const next = Math.min(Math.max(1, p), pages);
    runSearch(filters, next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Facet OPTION lists + baseline counts — fetched once, UNFILTERED, so the available
  // pills and the numbers on them stay stable (picking one filter never hides or
  // re-counts the others). Only the header "cases match" total reacts to the filters.
  const loadFacetOptions = async () => {
    try {
      const params = new URLSearchParams();
      params.set("fields", "tumor,sex,manufacturer,ct_phase,site_nat,year");
      params.set("top_k", "8");
      const res = await fetch(`${API_BASE}/api/facets?${params.toString()}`);
      const data = await res.json();
      setFacetData({
        counts: data.facets ?? {},
        unknown: data.unknown_counts ?? {},
        total: data.total ?? 0,
        datasetCounts: data.dataset_counts ?? {},
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Live count of cases matching the current draft filters (shown in the panel header).
  const loadMatchTotal = async (f: Filters) => {
    try {
      const params = buildSearchParams(f, { perPage: 1 });
      const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);
      const data = await res.json();
      setMatchTotal(data.total ?? 0);
    } catch (e) {
      console.error(e);
    }
  };

  // On mount: if the URL carries filters (a shared/bookmarked cohort), restore and run
  // them; otherwise show the curated grid.
  useEffect(() => {
    const urlFilters = parseFiltersFromParams(searchParams);
    if (countActiveFilters(urlFilters) > 0) {
      setShowFilters(true);
      runSearch(urlFilters);
    } else {
      loadCurated();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the (static, unfiltered) option lists the first time the panel opens.
  useEffect(() => {
    if (showFilters && !facetData) loadFacetOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilters]);

  // Keep the header "cases match" total in sync with the current filters (debounced).
  useEffect(() => {
    const t = setTimeout(() => loadMatchTotal(filters), 200);
    return () => clearTimeout(t);
  }, [filters]);

  // Warm the code-split viewer chunk once the dashboard is idle, so the first
  // case-open is instant even when navigating via the case-ID search (no hover).
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const ric = w.requestIdleCallback;
    const id = ric
      ? ric(() => prefetchViewer())
      : window.setTimeout(prefetchViewer, 1500);
    return () => {
      if (ric) w.cancelIdleCallback?.(id as number);
      else window.clearTimeout(id as number);
    };
  }, []);

  const handleShuffle = async () => {
    setLoading(true);
    setPreviewMetadata({});
    setResultCount(null);
    setPage(1);
    setFilters(EMPTY_FILTERS); // shuffle is a fresh unfiltered draw — clear any active advanced-search filters
    setSearchParams({}); // drop filters from the URL
    try {
      const res = await fetch(
        `${API_BASE}/api/random?n=${CARD_COUNT}&k=120&scope=all`,
      );
      if (!res.ok) throw new Error(`Shuffle failed (${res.status})`);
      const data = await res.json();
      ingestItems(data.items ?? []);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  // Browse the entire dataset, paginated (no filters) — a one-click path to "see
  // everything" that still only loads one page at a time.
  const handleBrowseAll = () => {
    setFilters(EMPTY_FILTERS);
    setSearchParams({});
    runSearch(EMPTY_FILTERS, 1);
  };

  const activeFilterCount = countActiveFilters(filters);

  const toggleMulti = (key: MultiFilterKey, value: string) => {
    setFilters((f) => {
      const has = f[key].includes(value);
      return {
        ...f,
        [key]: has ? f[key].filter((v) => v !== value) : [...f[key], value],
      };
    });
  };

  // Count for a given facet value (e.g. how many cases match Sex=M given the other
  // active filters). null when facets haven't loaded yet.
  const facetCount = (field: string, value: string | number): number | null => {
    const rows = facetData?.counts[field];
    if (!rows) return null;
    const row = rows.find((r) => String(r.value) === String(value));
    return row ? row.count : 0;
  };

  // Small mono count shown inside a pill, e.g. "Male 4,210".
  const countBadge = (count: number | null) =>
    count == null ? null : (
      <span className={styles.countBadge}>{count.toLocaleString()}</span>
    );

  const handleApplyFilters = () => {
    // Encode the cohort into the URL so it's shareable/bookmarkable, then load it.
    setSearchParams(buildSearchParams(filters));
    runSearch(filters, 1);
    setShowFilters(false); // collapse the advanced-filters panel after applying
  };

  const handleResetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setResultCount(null);
    setPage(1);
    setSearchParams({});
    loadCurated();
  };

  const handleSearch = () => {
    if (searchId) {
      const clamped = Math.max(1, Math.min(9901, searchId));
      navigation("/case/" + clamped);
      return;
    }
    handleApplyFilters();
  };

  return (
    <div className="min-h-screen bg-white text-black relative overflow-x-hidden">
      {/* Ambient background orbs */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className={styles.orb1} />
        <div className={styles.orb2} />
        <div className={styles.orb3} />
      </div>

      <Header />

      {/* Case library */}
      <section className="mx-auto max-w-6xl px-6 pt-8 pb-16">
        <div className={styles.libraryCard}>
          {/* Section header */}
          <div className={styles.sectionHeader}>
            <span>Browse Library</span>
            <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
              <button className={styles.actionBtn} onClick={handleBrowseAll}>
                <IconDatabase size={14} />
                Browse all
              </button>
              <button className={styles.actionBtn} onClick={handleShuffle}>
                <IconArrowsShuffle size={14} />
                Shuffle Cases
              </button>
              <button
                className={`${styles.actionBtn} ${showSaved ? styles.actionBtnActive : ""}`}
                onClick={() => setShowSaved((v) => !v)}
              >
                <IconBookmark size={14} />
                {showSaved
                  ? "Back to browse"
                  : `Saved${savedCases.length ? ` (${savedCases.length})` : ""}`}
              </button>
              {!showSaved && matchTotal !== null && (
                <span aria-live="polite" className={styles.matchTotal}>
                  {`${matchTotal.toLocaleString()} ${
                    matchTotal === 1 ? "case matches" : "cases match"
                  }`}
                </span>
              )}
            </div>
          </div>

          {/* Case search */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              placeholder="Search by case ID, e.g. 17, 35, 121"
              className={styles.searchInput}
              value={searchId || ""}
              onChange={(e) => {
                const val = e.target.value;
                // Allow numbers only or empty
                if (val === "" || /^\d+$/.test(val)) {
                  setSearchId(val ? Number(val) : 0);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSearch();
                }
              }}
            />

            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`${styles.filterToggle} ${showFilters ? styles.filterToggleOpen : ""}`}
            >
              <span className="flex items-center gap-2">
                <IconAdjustmentsHorizontal size={15} />
                Advanced filters
                {activeFilterCount > 0 && (
                  <span className={styles.filterBadge}>{activeFilterCount}</span>
                )}
              </span>
              <IconChevronDown
                size={15}
                className={`${styles.chevron} ${showFilters ? styles.chevronOpen : ""}`}
              />
            </button>

            <button className={styles.searchBtn} onClick={handleSearch}>
              Search
            </button>
          </div>

          {/* Advanced search panel */}
          {showFilters && (
            <div className={styles.filterPanel}>
              {/* Dataset */}
              <div className="flex flex-col gap-2.5">
                <span className={styles.filterLabel}>Dataset</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={pillClass(filters.dataset.length === 0)}
                    onClick={() => setFilters((f) => ({ ...f, dataset: [] }))}
                  >
                    Any
                  </button>
                  {DATASET_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={pillClass(filters.dataset.includes(opt.value))}
                      onClick={() => toggleMulti("dataset", opt.value)}
                    >
                      {opt.label}
                      {countBadge(facetData?.datasetCounts[opt.value] ?? null)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tumor */}
              <div className="flex flex-col gap-2.5">
                <span className={styles.filterLabel}>Tumor</span>
                <div className="flex flex-wrap gap-2">
                  {TUMOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={pillClass(filters.tumor === opt.value)}
                      onClick={() =>
                        setFilters((f) => ({ ...f, tumor: opt.value }))
                      }
                    >
                      {opt.label}
                      {countBadge(
                        opt.value === "tumor"
                          ? facetCount("tumor", 1)
                          : opt.value === "no_tumor"
                            ? facetCount("tumor", 0)
                            : null,
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sex */}
              <div className="flex flex-col gap-2.5">
                <span className={styles.filterLabel}>Sex</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={pillClass(filters.sex.length === 0)}
                    onClick={() => setFilters((f) => ({ ...f, sex: [] }))}
                  >
                    Any
                  </button>
                  {SEX_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={pillClass(filters.sex.includes(opt.value))}
                      onClick={() => toggleMulti("sex", opt.value)}
                    >
                      {opt.label}
                      {countBadge(
                        opt.value === "UNKNOWN"
                          ? (facetData?.unknown.sex ?? null)
                          : facetCount("sex", opt.value),
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Age */}
              <div className="flex flex-col gap-2.5">
                <span className={styles.filterLabel}>Age</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={pillClass(filters.age.length === 0)}
                    onClick={() => setFilters((f) => ({ ...f, age: [] }))}
                  >
                    Any
                  </button>
                  {AGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={pillClass(filters.age.includes(opt.value))}
                      onClick={() => toggleMulti("age", opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Metadata facets — manufacturer / CT phase / site / year; values + live counts from /api/facets */}
              {FACET_GROUPS.map((g) => {
                const rows = facetData?.counts[g.field] ?? [];
                const selected = filters[g.key];
                return (
                  <div key={g.key} className="flex flex-col gap-2.5">
                    <span className={styles.filterLabel}>{g.title}</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={pillClass(selected.length === 0)}
                        onClick={() =>
                          setFilters((f) => ({ ...f, [g.key]: [] }))
                        }
                      >
                        Any
                      </button>
                      {rows.length === 0 ? (
                        <span className={styles.facetsLoading}>
                          {facetData ? "—" : "Loading…"}
                        </span>
                      ) : (
                        rows.map((r) => {
                          const val = String(r.value);
                          return (
                            <button
                              key={val}
                              className={pillClass(selected.includes(val))}
                              onClick={() => toggleMulti(g.key, val)}
                            >
                              {r.label ?? val}
                              {countBadge(r.count)}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}

            </div>
          )}
        </div>

        {/* Results summary */}
        {!showSaved && resultCount !== null && (
          <div className={styles.resultsSummary}>
            <span className={styles.resultsText}>
              {resultCount === 0
                ? "No cases match these filters"
                : `${resultCount.toLocaleString()} ${
                    resultCount === 1 ? "result" : "results"
                  } · page ${page} of ${Math.max(1, Math.ceil(resultCount / PER_PAGE)).toLocaleString()}`}
            </span>
            <button onClick={handleResetFilters} className={styles.clearBtn}>
              <IconX size={13} />
              Clear filters
            </button>
          </div>
        )}

        {/* Grid */}
        {showSaved && savedCases.length === 0 ? (
          <div className={styles.emptyState}>
            No saved cases yet — click the bookmark on any case to save it here.
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {showSaved
              ? savedCases.map((c) => (
                  <Preview
                    key={c.id}
                    id={c.id}
                    previewMetadata={{ sex: c.sex, age: c.age, tumor: c.tumor }}
                    saved
                    onToggleSave={() =>
                      handleToggleSave(c.id, {
                        sex: c.sex,
                        age: c.age,
                        tumor: c.tumor,
                      })
                    }
                    compareSelected={compareIds.includes(c.id)}
                    onToggleCompare={() => toggleCompare(c.id)}
                  />
                ))
              : loading
                ? Array.from({
                    length: resultCount !== null ? PER_PAGE : CARD_COUNT,
                  }).map((_, i) => (
                    <div
                      key={i}
                      className={`bm-card-skeleton rounded-xl ${styles.skeleton}`}
                    />
                  ))
                : PREVIEW_IDS.map((id) => (
                    <Preview
                      key={id}
                      id={id}
                      previewMetadata={previewMetadata[id]}
                      saved={savedIds.has(id)}
                      onToggleSave={() => handleToggleSave(id)}
                      compareSelected={compareIds.includes(id)}
                      onToggleCompare={() => toggleCompare(id)}
                    />
                  ))}
          </div>
        )}

        {/* Page navigation over the current cohort — only one page is ever in the DOM. */}
        {!showSaved &&
          resultCount !== null &&
          resultCount > PER_PAGE &&
          (() => {
            const pages = Math.max(1, Math.ceil(resultCount / PER_PAGE));
            return (
              <div className={styles.pager}>
                <button
                  className={pagerBtnClass(page <= 1)}
                  disabled={page <= 1}
                  onClick={() => goToPage(page - 1)}
                >
                  ‹ Prev
                </button>
                <span className={styles.pagerInfo}>
                  Page {page.toLocaleString()} of {pages.toLocaleString()}
                </span>
                <button
                  className={pagerBtnClass(page >= pages)}
                  disabled={page >= pages}
                  onClick={() => goToPage(page + 1)}
                >
                  Next ›
                </button>
                <form
                  className={styles.pagerGoForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = parseInt(pageInput, 10);
                    if (!Number.isNaN(n)) {
                      goToPage(n);
                      setPageInput("");
                    }
                  }}
                >
                  <input
                    type="number"
                    min={1}
                    max={pages}
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    placeholder={`Go to… (1–${pages})`}
                    aria-label="Go to page"
                    className={styles.pagerInput}
                  />
                  <button
                    type="submit"
                    disabled={pageInput.trim() === ""}
                    className={pagerBtnClass(pageInput.trim() === "")}
                  >
                    Go
                  </button>
                </form>
              </div>
            );
          })()}
      </section>

      {/* Floating comparison tray — appears once a case is picked via the compare button
			    on a card; links to the /compare view when two are selected. */}
      {compareIds.length > 0 && (
        <div className={styles.compareTray}>
          <span className={styles.compareTrayIds}>
            {compareIds.map((id) => `#${id}`).join("  vs  ")}
          </span>
          {compareIds.length < 2 && (
            <form
              className={styles.compareTrayForm}
              onSubmit={(e) => {
                e.preventDefault();
                submitTypedCompare();
              }}
            >
              <input
                value={compareTyped}
                onChange={(e) =>
                  setCompareTyped(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="type case #"
                inputMode="numeric"
                aria-label="Add a case by number"
                className={styles.compareTrayInput}
              />
              <button
                type="submit"
                disabled={compareTyped.trim() === ""}
                className={styles.compareTrayAddBtn}
              >
                Add
              </button>
            </form>
          )}
          <button
            onClick={() => setCompareIds([])}
            className={styles.compareTrayBtn}
          >
            Clear
          </button>
          <button
            disabled={compareIds.length < 2}
            onClick={() =>
              navigation(`/compare?a=${compareIds[0]}&b=${compareIds[1]}`)
            }
            className={styles.compareTrayCompareBtn}
          >
            Compare →
          </button>
        </div>
      )}
    </div>
  );
}

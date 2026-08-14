import { API_BASE } from "./constants";
import { itemToId, type SearchItem } from "./search";

// Warm the Dataset landing grid (the deterministic "curated" set — the same
// quality-sorted tumor / no-tumor cases every visit) so that navigating there
// from another tab renders instantly instead of paying the search + thumbnail
// fetch on the click. On a real connection that fetch is what makes an
// Overview/Upload -> Dataset tab-switch feel slow even though a full page load
// (which folds the same fetch into the expected load) feels fine.
//
// Runs at most once per session and swallows all errors — it is a pure warm-up.
let started = false;

export function prefetchCurated(): void {
  if (started || typeof window === "undefined" || typeof fetch === "undefined") {
    return;
  }
  started = true;

  const HALF = 4; // mirrors CARD_COUNT / 2 in the dashboard's loadCurated
  const grab = (tumor: 0 | 1) =>
    fetch(`${API_BASE}/api/search?tumor=${tumor}&sort_by=quality&per_page=${HALF}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  Promise.all([grab(1), grab(0)])
    .then((results) => {
      for (const res of results) {
        const items: SearchItem[] = res?.items ?? [];
        for (const it of items) {
          const id = itemToId(it);
          if (!id) continue;
          // Preload with the SAME url Preview will request (itemToId gives the
          // exact numeric id), so the browser serves the card from cache.
          const img = new Image();
          img.src = `${API_BASE}/api/get_image_preview/${id}`;
        }
      }
    })
    .catch(() => {});
}

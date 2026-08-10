// Capture-only helper for the launch video (branch: demo/cinematic-capture).
//
// Pulls N dataset thumbnails to public/thumbs/ so /wall can render the closing
// shot from disk. Recording against the live API means ~1200 requests firing
// mid-take, which stutters the pull-back; from disk it is smooth.
//
//   node scripts/download-thumbs.mjs --api https://bodymaps.wse.jhu.edu --n 1200
//
// Re-runnable: already-downloaded tiles are skipped, so an interrupted run just
// picks up where it left off. Writes manifest.json (id -> filename), which /wall
// reads when given ?local=1.
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public", "thumbs");
const CONCURRENCY = 8;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const API = String(arg("api", "http://localhost:5001")).replace(/\/$/, "");
const COUNT = Number(arg("n", 1200));

const EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Mirror of itemToId in src/helpers/search.ts. */
function itemToId(it) {
  const raw = String(it.case_id ?? it["PanTS ID"] ?? it.id ?? "").trim();
  if (!raw) return null;
  if (raw.toUpperCase().startsWith("CV")) return raw;
  const digits = raw.match(/\d+/);
  return digits ? String(Number(digits[0])) : null;
}

async function fetchIds() {
  const url = `${API}/api/search?dataset=all&sort_by=quality&per_page=${COUNT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search failed (${res.status}) — is ${API} reachable?`);
  const data = await res.json();
  const ids = (data.items ?? []).map(itemToId).filter(Boolean);
  if (!ids.length) throw new Error("search returned no items");
  return ids;
}

async function downloadOne(id, existing) {
  const already = existing.get(String(id));
  if (already) return { id, name: already, skipped: true };

  const res = await fetch(`${API}/api/get_image_preview/${id}`);
  if (!res.ok) return { id, name: null, error: `HTTP ${res.status}` };

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = EXT_BY_TYPE[type] ?? "jpg";
  const name = `${id}.${ext}`;
  await writeFile(join(OUT_DIR, name), Buffer.from(await res.arrayBuffer()));
  return { id, name };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Map of id -> existing filename, so a re-run skips what is already on disk.
  const existing = new Map();
  for (const file of await readdir(OUT_DIR)) {
    const dot = file.lastIndexOf(".");
    if (dot > 0 && file !== "manifest.json") existing.set(file.slice(0, dot), file);
  }

  const ids = await fetchIds();
  console.log(`${ids.length} ids from ${API} · ${existing.size} already on disk`);

  const manifest = {};
  let done = 0;
  let failed = 0;

  const queue = [...ids];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const r = await downloadOne(id, existing);
        if (r.name) manifest[String(r.id)] = r.name;
        else failed++;
      } catch (e) {
        failed++;
        console.warn(`  ${id}: ${e.message}`);
      }
      if (++done % 100 === 0) console.log(`  ${done}/${ids.length}`);
    }
  });

  await Promise.all(workers);
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest));

  console.log(`\ndone — ${Object.keys(manifest).length} tiles, ${failed} failed`);
  console.log(`open /wall?hero=<caseId>&n=${COUNT}&local=1`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

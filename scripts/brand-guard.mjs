#!/usr/bin/env node
/**
 * brand-guard.mjs — BodyMaps brand invariants for the PanTS-Demo frontend.
 *
 * Run:  node scripts/brand-guard.mjs        (from the repo root)
 * Docs: BRANDING.md (repo root)
 *
 * Dependency-free by design so it never touches package.json.
 * Each rule bans a pattern that the brand alignment PR fully eradicated,
 * except in the per-rule ALLOW list — the explicit register of deferred
 * files (surfaces under active development that will be migrated in a
 * follow-up). Allow entries are rename-tolerant: a file matches if its
 * path OR its basename equals an entry's, so moving a deferred file into
 * a folder does not turn CI red. Do not add new files to an ALLOW list
 * to silence a failure; fix the color/font instead (see BRANDING.md).
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEXT_EXT = /\.(css|tsx|ts|jsx|js|mjs|html|json|md|yml|yaml|svg)$/;

const RULES = [
  {
    name: "no-external-font-hosts",
    pattern: /fonts\.(googleapis|gstatic)\.com/i,
    why: "Fonts are self-hosted from PanTS-Demo/public/fonts (IBM Plex).",
    allow: [
      "PanTS-Demo/src/routes/UploadPage.css",
      // Pre-registered: added by in-flight branches (feat/share-patient-card
      // family); migrate to self-hosted Plex when that work lands.
      "PanTS-Demo/src/routes/SharePatientCard.tsx",
    ],
  },
  {
    name: "no-off-brand-font-names",
    // Tolerates JSX-escaped quotes: fontFamily: "\"Space Grotesk\", ..."
    pattern: /["'](Space Grotesk|JetBrains Mono|Space Mono)\\?["']/,
    why: 'Use var(--font-sans) / var(--font-mono) or "IBM Plex Sans" / "IBM Plex Mono".',
    allow: [
      "PanTS-Demo/src/components/AIAssistant/AISidebar.css",
      "PanTS-Demo/src/components/segmentation/MaskingSelect.css",
      "PanTS-Demo/src/components/segmentation/SegmentEffectPanel.css",
      "PanTS-Demo/src/components/segmentation/SegmentsPopup.css",
      "PanTS-Demo/src/components/segmentation/SliceAnchorPickerUI.tsx",
      "PanTS-Demo/src/components/viewer/AnnotationToolbar.css",
      "PanTS-Demo/src/components/viewer/AnnotationToolbar.tsx",
      "PanTS-Demo/src/components/viewer/FlyoutPrimitives.css",
      "PanTS-Demo/src/components/walkthrough/ToolWalkthrough.css",
      "PanTS-Demo/src/routes/UploadPage.css",
      "PanTS-Demo/src/routes/UploadPage.tsx",
      // Alias @font-face shim: maps the retired families onto IBM Plex so
      // deferred surfaces render deterministically until migrated.
      "PanTS-Demo/src/styles/brand.css",
    ],
  },
  {
    name: "no-inter-font",
    // Matches CSS font-family, JSX fontFamily inline styles, and Google
    // Fonts family= query params.
    pattern: /(font-family|fontFamily)\s*:\s*[^;\n]{0,60}\bInter\b|family=Inter/,
    why: "The brand typeface is IBM Plex Sans (see BRANDING.md).",
    allow: [
      // Pre-registered for the in-flight share-patient-card branches.
      "PanTS-Demo/src/routes/SharePatientCard.tsx",
    ],
  },
  {
    name: "no-invented-mark",
    pattern: /#27379b/i,
    why: "The navy crosshair mark was never an approved logo. Use public/bodymaps-logo.svg (adopted mark).",
    allow: ["PanTS-Demo/src/test/brand.test.ts"], // the invariant test asserts this hex is absent
  },
  {
    name: "no-jhu-blue",
    // Hex forms plus rgb()/rgba() triplet of #002D72.
    pattern: /#002d72|#00399a|#68ace5|rgba?\(\s*0\s*,\s*45\s*,\s*114/i,
    why: "JHU Heritage/Spirit Blue is not a BodyMaps color. CTAs/links on light: var(--accent-deep); accents on dark: var(--accent) / var(--accent-tint).",
    // Emptied: every file that was deferred here has been migrated off
    // Heritage/Spirit Blue, so the rule is now enforced everywhere.
    allow: [],
  },
  {
    name: "no-off-brand-blue-accents",
    pattern: /#6ea8fe|#2563eb|#1d4ed8|#7aa2ff/i,
    why: "Blue accent families are retired. Use the accent tokens (see BRANDING.md).",
    allow: [
      "PanTS-Demo/src/components/MeasurementPanel/MeasurementPanel.css",
      "PanTS-Demo/src/components/Preview.tsx",
      "PanTS-Demo/src/components/walkthrough/ToolWalkthrough.css",
      "PanTS-Demo/src/routes/VisualizationPage.css",
    ],
  },
  {
    name: "reserved-teal",
    pattern: /#0b4f6c/i,
    why: "Teal #0B4F6C is reserved and unused per the brand book.",
    allow: ["PanTS-Demo/src/styles/brand.css"],
  },
];

// Head-metadata invariants for the app shell.
const INDEX_HTML = "PanTS-Demo/index.html";
const HEAD_MUST_CONTAIN = [
  ['rel="icon" type="image/svg+xml" href="/favicon.svg"', "brand favicon link"],
  ['rel="apple-touch-icon"', "apple-touch-icon link"],
  ['name="theme-color" content="#0F172A"', "ink theme-color"],
  ['name="description"', "meta description"],
  ['property="og:image"', "og:image tag"],
];

let files;
try {
  files = execSync("git ls-files -- PanTS-Demo", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split("\n")
    .filter((f) => f && TEXT_EXT.test(f) && !f.includes("node_modules"));
} catch (err) {
  console.error("brand-guard: requires a git checkout (git ls-files failed).");
  console.error(String(err.stderr || err.message).trim().split("\n")[0]);
  process.exit(1);
}

const basename = (p) => p.slice(p.lastIndexOf("/") + 1);
const isAllowed = (rule, f) =>
  rule.allow.includes(f) || rule.allow.some((a) => basename(a) === basename(f));

let failures = 0;

for (const rule of RULES) {
  for (const f of files) {
    if (isAllowed(rule, f)) continue;
    const path = ROOT + f;
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (rule.pattern.test(line)) {
        failures++;
        console.error(`FAIL [${rule.name}] ${f}:${i + 1}\n      ${line.trim().slice(0, 120)}\n      → ${rule.why}`);
      }
    });
  }
}

const indexHtml = readFileSync(ROOT + INDEX_HTML, "utf8");
for (const [needle, label] of HEAD_MUST_CONTAIN) {
  if (!indexHtml.includes(needle)) {
    failures++;
    console.error(`FAIL [head-metadata] ${INDEX_HTML}: missing ${label} (expected to contain: ${needle})`);
  }
}

if (failures) {
  console.error(`\nbrand-guard: ${failures} violation(s). See BRANDING.md at the repo root for the tokens and rules.`);
  process.exit(1);
}
console.log(`brand-guard: OK (${files.length} files checked, ${RULES.length} rules + head metadata)`);

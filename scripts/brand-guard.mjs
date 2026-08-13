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
 * files (hot files under active development that will be migrated in a
 * follow-up). Do not add new files to an ALLOW list to silence a failure;
 * fix the color/font instead (see BRANDING.md for the token to use).
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const TEXT_EXT = /\.(css|tsx|ts|jsx|js|mjs|html|json|md|yml|yaml|svg)$/;

const RULES = [
  {
    name: "no-external-font-hosts",
    pattern: /fonts\.(googleapis|gstatic)\.com/i,
    why: "Fonts are self-hosted from PanTS-Demo/public/fonts (IBM Plex).",
    allow: ["PanTS-Demo/src/routes/UploadPage.css"],
  },
  {
    name: "no-off-brand-font-names",
    pattern: /["'](Space Grotesk|JetBrains Mono|Space Mono)["']/,
    why: 'Use var(--font-sans) / var(--font-mono) or "IBM Plex Sans" / "IBM Plex Mono".',
    allow: [
      "PanTS-Demo/src/components/AIAssistant/AISidebar.css",
      "PanTS-Demo/src/components/segmentation/MaskingSelect.css",
      "PanTS-Demo/src/components/segmentation/SegmentEffectPanel.css",
      "PanTS-Demo/src/components/segmentation/SegmentsPopup.css",
      "PanTS-Demo/src/components/viewer/AnnotationToolbar.css",
      "PanTS-Demo/src/components/viewer/FlyoutPrimitives.css",
      "PanTS-Demo/src/components/walkthrough/ToolWalkthrough.css",
      "PanTS-Demo/src/routes/UploadPage.css",
      "PanTS-Demo/src/routes/UploadPage.tsx",
    ],
  },
  {
    name: "no-inter-font",
    pattern: /font-family:\s*["']Inter|family=Inter/,
    why: "The brand typeface is IBM Plex Sans (see BRANDING.md).",
    allow: [],
  },
  {
    name: "no-invented-mark",
    pattern: /#27379b/i,
    why: "The navy crosshair mark was never an approved logo. Use public/bodymaps-logo.svg (adopted mark).",
    allow: ["PanTS-Demo/src/test/brand.test.ts"], // the invariant test asserts this hex is absent
  },
  {
    name: "no-jhu-blue",
    pattern: /#002d72|#00399a|#68ace5/i,
    why: "JHU Heritage/Spirit Blue is not a BodyMaps color. CTAs/links on light: var(--accent-deep); accents on dark: var(--accent) / var(--accent-tint).",
    allow: [
      "PanTS-Demo/src/components/segmentation/SegmentEffectPanel.css",
      "PanTS-Demo/src/components/segmentation/SegmentsPopup.css",
      "PanTS-Demo/src/components/segmentation/SegmentsPopup.tsx",
      "PanTS-Demo/src/components/segmentation/SliceAnchorPickerUI.tsx",
      "PanTS-Demo/src/components/viewer/AnnotationToolbar.css",
      "PanTS-Demo/src/components/viewer/AnnotationToolbar.tsx",
      "PanTS-Demo/src/components/viewer/FlyoutPrimitives.css",
      "PanTS-Demo/src/routes/UploadPage.css",
      "PanTS-Demo/src/routes/UploadPage.tsx",
      "PanTS-Demo/src/routes/VisualizationPage.tsx",
    ],
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

const files = execSync("git ls-files -- PanTS-Demo", { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && TEXT_EXT.test(f) && !f.includes("node_modules"));

let failures = 0;

for (const rule of RULES) {
  for (const f of files) {
    if (rule.allow.includes(f)) continue;
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

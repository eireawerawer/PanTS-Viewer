/**
 * Site-copy guard: the canonical strings in src/helpers/copy.ts must be what
 * the shipped surfaces actually say, and retired wording must stay gone.
 * Extend this as each copy PR lands; it is what stops an upstream merge from
 * quietly reverting the text.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SITE_DESCRIPTION, SITE_TITLE } from "../helpers/copy";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("site copy guard", () => {
  it("index.html title and descriptions match the canonical copy", () => {
    const html = read("index.html");
    expect(html).toContain(`<title>${SITE_TITLE}</title>`);
    expect(html).toContain(`property="og:title" content="${SITE_TITLE}"`);
    expect(html).toContain(`name="twitter:title" content="${SITE_TITLE}"`);
    for (const attr of [
      'name="description"',
      'property="og:description"',
      'name="twitter:description"',
    ]) {
      expect(html).toContain(`${attr} content="${SITE_DESCRIPTION}"`);
    }
  });

  it("retired wording does not come back", () => {
    const html = read("index.html");
    expect(html).not.toContain("A CT Segmentation Platform");
  });
});

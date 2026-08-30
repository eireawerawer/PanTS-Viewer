/**
 * Canonical site copy shared across surfaces. Change strings here, not inline:
 * src/test/copy.test.ts guards them so an upstream merge cannot silently revert
 * the wording (that happened once to the brand pass).
 */

/** Persistent nonclinical boundary. Same sentence everywhere it appears. */
export const NONCLINICAL_WARNING =
  "For nonclinical use only. Not medical advice or for patient care.";

/** One-paragraph orientation for a first-time visitor on the landing page. */
export const LANDING_OVERVIEW =
  "Browse the library in 2D and 3D, upload your own CT for AI segmentation, and annotate or refine the results.";

/** Browser-tab / link-preview title (index.html <title>, og:title, twitter:title). */
export const SITE_TITLE = "BodyMaps: CT Library, Segmentation, and Annotation";

/** Meta / og / twitter description. */
export const SITE_DESCRIPTION =
  "Browse body CT scans in 2D and 3D, upload CT for AI segmentation, and annotate results. For nonclinical use only.";

/** Footer, left column. Kept from the previous footer (the PI liked it). */
export const FOOTER_TAGLINE =
  "BodyMaps — the intelligence layer for medical imaging AI.";

/** Footer, right column: inquiry routing. The link text follows this lead. */
export const FOOTER_INQUIRY_LEAD =
  "For private licensing and other inquiries, contact BodyMaps, Inc. through";

/** The one external contact route (a separate BodyMaps, Inc. site). */
export const CONTACT_URL = "https://thebodymaps.com/contact/";
export const CONTACT_LINK_TEXT = "thebodymaps.com/contact";

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

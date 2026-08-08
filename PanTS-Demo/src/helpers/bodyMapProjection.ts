// ─────────────────────────────────────────────────────────────────────────
// Projects a real case-derived organ centroid (centroid_mm, from
// _build_report_data in api_blueprint.py — world coordinates via
// nib.affines.apply_affine, RAS convention: X=Right+, Y=Anterior+,
// Z=Superior+) onto a normalized 2D position on a front-view body
// silhouette.
//
// This is intentionally NOT precise anatomical localization. It's a
// per-case normalization: for a given case, we look at the spread of every
// segmented organ's centroid and place this organ's marker proportionally
// within that spread, clamped to the torso band of the silhouette (this
// dataset is abdominal/thoracic CT, so markers are kept off the head/legs
// region rather than extrapolating there).
//
// Kept as pure functions with no UI dependency, on purpose: the component
// stays dumb, and a better anatomical normalization (e.g. using real body
// bounds from the mesh-manifest endpoint, or population-average organ
// atlases) can be swapped in later without touching SharePatientCard.tsx.
// ─────────────────────────────────────────────────────────────────────────

export interface CaseBounds {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
}

export interface BodyMapPoint {
  /** 0–100, percentage position within the silhouette's torso band. */
  xPct: number;
  yPct: number;
}

type OrganLike = { centroid_mm?: [number, number, number] };

/**
 * Scans every organ in the case for its centroid and returns the real
 * min/max spread on the left-right (X) and head-foot (Z) axes. Returns
 * null if there isn't enough data to normalize against (e.g. fewer than
 * two organs with a centroid) — callers should treat null as "no marker,"
 * never guess a placement.
 */
export function computeCaseBounds(organs: Record<string, OrganLike>): CaseBounds | null {
  const centroids = Object.values(organs)
    .map(o => o.centroid_mm)
    .filter((c): c is [number, number, number] => Array.isArray(c) && c.length === 3);

  if (centroids.length < 2) return null;

  const xs = centroids.map(c => c[0]);
  const zs = centroids.map(c => c[2]);

  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };
}

// Torso band of the silhouette (percent of its viewBox), since this
// dataset is abdominal/thoracic — real markers are kept inside a region
// that always reads as "on the body," never near the head or legs where
// this case data was never designed to project.
const TORSO_X_MIN = 30, TORSO_X_MAX = 70;
const TORSO_Y_MIN = 26, TORSO_Y_MAX = 76;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Projects one organ's real centroid into a 2D point on the silhouette,
 * normalized against this case's own centroid spread. Returns null if the
 * centroid or bounds are missing/degenerate — callers must handle null by
 * omitting the marker, not by falling back to a guessed position.
 */
export function projectCentroidToBodyMap(
  centroid_mm: [number, number, number] | undefined,
  bounds: CaseBounds | null,
): BodyMapPoint | null {
  if (!centroid_mm || !bounds) return null;
  const [x, , z] = centroid_mm;
  const { minX, maxX, minZ, maxZ } = bounds;

  const xSpan = maxX - minX;
  const zSpan = maxZ - minZ;
  if (xSpan === 0 || zSpan === 0) return null;

  // X: patient Right+ increases with array index; mirrored here so the
  // silhouette reads in standard radiological display convention (patient's
  // right appears on the viewer's left). Z: Superior+ increases upward in
  // patient space, so it's inverted for screen Y (down = larger Y).
  const normX = 1 - (x - minX) / xSpan;
  const normZ = 1 - (z - minZ) / zSpan;

  const xPct = clamp(TORSO_X_MIN + normX * (TORSO_X_MAX - TORSO_X_MIN), TORSO_X_MIN, TORSO_X_MAX);
  const yPct = clamp(TORSO_Y_MIN + normZ * (TORSO_Y_MAX - TORSO_Y_MIN), TORSO_Y_MIN, TORSO_Y_MAX);

  return { xPct, yPct };
}
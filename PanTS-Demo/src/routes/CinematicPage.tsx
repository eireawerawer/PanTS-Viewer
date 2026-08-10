// Capture-only route for the launch video (branch: demo/cinematic-capture).
//
// Renders the case's 3D meshes full-bleed on black with no chrome, no cursor and
// no controls, so a screen recording of this page is usable footage as-is. The
// "assemble" shot is driven here: one organ is held alone, then the rest fade in
// one at a time.
//
//   /cinematic/17?start=liver&hold=1800&step=160&speed=0.6
//
// Every knob is a query param so the shot can be retuned on the day without a
// rebuild. Press R to replay the reveal without reloading.
//
// This route is not linked from anywhere in the UI — it exists to be recorded.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { SegmentationMeshViewer, fetchMeshManifest } from "../components/viewer/MeshViewer";
import type { OrganMeshInfo } from "../types";

/** Read a numeric query param, falling back when absent or unparseable. */
function num(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read a 0/1 query param. */
function flag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return raw !== "0" && raw !== "false";
}

/**
 * Order the organs for the reveal: the "start" organ first (matched on key or
 * name, case-insensitive), then the rest largest-first so the body builds from
 * its bulk inwards rather than popping in at random.
 */
function revealOrder(organs: OrganMeshInfo[], start: string): OrganMeshInfo[] {
  const wanted = start.trim().toLowerCase();
  const isStart = (o: OrganMeshInfo) =>
    o.key?.toLowerCase() === wanted || o.name?.toLowerCase() === wanted;

  const head = organs.filter(isStart);
  const tail = organs
    .filter((o) => !isStart(o))
    .sort((a, b) => (b.vertices ?? 0) - (a.vertices ?? 0));

  return [...head, ...tail];
}

export default function CinematicPage() {
  const { caseId = "" } = useParams();
  const [params] = useSearchParams();

  const start = params.get("start") ?? "liver";
  const holdMs = num(params, "hold", 1800);
  const stepMs = num(params, "step", 160);
  const speed = num(params, "speed", 0.6);
  const opacity = num(params, "opacity", 100);
  const rotate = flag(params, "rotate", true);
  const reveal = flag(params, "reveal", true);
  const isSession = flag(params, "session", false);

  const [organs, setOrgans] = useState<OrganMeshInfo[] | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());
  // Bumped by the R key to restart the reveal between takes.
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchMeshManifest(caseId, isSession)
      .then((manifest) => {
        if (alive) setOrgans(manifest.organs);
      })
      .catch((err) => console.error("cinematic: manifest failed", err));
    return () => {
      alive = false;
    };
  }, [caseId, isSession]);

  const ordered = useMemo(
    () => (organs ? revealOrder(organs, start) : []),
    [organs, start],
  );

  // Drive the assemble: start organ alone for holdMs, then one more every stepMs.
  useEffect(() => {
    if (!ordered.length) return;

    if (!reveal) {
      setVisibleIds(new Set(ordered.map((o) => o.id)));
      return;
    }

    setVisibleIds(new Set(ordered.length ? [ordered[0].id] : []));

    const timers = ordered.slice(1).map((organ, i) =>
      setTimeout(() => {
        setVisibleIds((prev) => new Set(prev).add(organ.id));
      }, holdMs + i * stepMs),
    );

    return () => timers.forEach(clearTimeout);
  }, [ordered, reveal, holdMs, stepMs, runId]);

  const replay = useCallback((e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", replay);
    return () => window.removeEventListener("keydown", replay);
  }, [replay]);

  // MeshViewer indexes checkState by organ id, so the array has to be long enough
  // to hold the highest id rather than just the organ count.
  const checkState = useMemo(() => {
    if (!organs?.length) return [];
    const size = Math.max(...organs.map((o) => o.id)) + 1;
    return Array.from({ length: size }, (_, id) => visibleIds.has(id));
  }, [organs, visibleIds]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#050505",
        cursor: "none",
        // MeshViewer renders a plain "Loading 3D segmentation…" string before its
        // own manifest fetch resolves. Nothing else on this route draws text, so
        // making text invisible keeps that out of the recording.
        color: "transparent",
      }}
    >
      {organs && (
        <SegmentationMeshViewer
          caseId={caseId}
          checkState={checkState}
          loading={false}
          opacity={opacity}
          crosshairMm={null}
          isSession={isSession}
          autoRotate={rotate}
          autoRotateSpeed={speed}
          cinematic
        />
      )}
    </div>
  );
}

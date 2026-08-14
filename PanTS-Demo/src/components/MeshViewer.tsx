import { Bounds, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import { APP_CONSTANTS } from "../helpers/constants";
import { cornerstoneLpsMmToThree, type Vec3 } from "../helpers/utils";
import type { MeshManifest } from "../types";
import { OrganMesh } from "./viewer/OrganMesh";
import { SceneCrosshair3D } from "./SceneCrosshair3D";
import type { Color } from "@cornerstonejs/core/types";
import { LiveSegmentMesh } from "./viewer/LiveSegmentMesh";
import type { CheckBoxData } from "../types";
import { getEditedSegments, subscribeToSegmentationEdits } from "../helpers/CornerstoneNifti2";

type SegmentationMeshViewerProps = {
  caseId: string;
  loading: boolean
  checkState: boolean[];
  opacity: number;
  crosshairMm: Vec3 | null
  customOrgans?: CheckBoxData[];
  labelColorMap?: { [key: number]: Color };
};

export async function fetchMeshManifest(caseId: string): Promise<MeshManifest> {
  const res = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/cases/${caseId}/mesh-manifest`);
  if (!res.ok) throw new Error(`Failed to fetch mesh manifest: ${res.status}`);
  const manifest: unknown = await res.json();
  if (
    !manifest
    || typeof manifest !== "object"
    || !Array.isArray((manifest as Partial<MeshManifest>).organs)
    || !Array.isArray((manifest as Partial<MeshManifest>).center)
    || !(manifest as Partial<MeshManifest>).bounds
  ) {
    throw new Error("Mesh manifest has an invalid shape");
  }
  return manifest as MeshManifest;
}

export function SegmentationMeshViewer({ caseId, checkState, loading, opacity, crosshairMm, customOrgans = [], labelColorMap = {}}: SegmentationMeshViewerProps) {
  const [manifest, setManifest] = useState<MeshManifest | null>(null);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const [unavailable, setUnavailable] = useState(false);
  // Bumped on every mask edit so editedSegments below is recomputed — the 3D pane
  // needs to know the instant a static organ's mask changes, not just at mount.
  const [, setEditVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToSegmentationEdits(() => setEditVersion((v) => v + 1));
    return unsubscribe;
  }, []);

  // Segment indices touched since the case loaded — includes edits to the STATIC
  // 32-organ catalog, not just brand-new custom classes.
  const editedSegments = getEditedSegments();

  const crosshairPosition = useMemo(() => {
    if (!manifest || !crosshairMm) return null;
    return cornerstoneLpsMmToThree(crosshairMm, manifest.center);
  }, [manifest, crosshairMm]);

  useEffect(() => {
    let alive = true;
    setManifest(null);
    setLoaded({});
    setUnavailable(false);
    fetchMeshManifest(caseId)
      .then((data) => {
        if (!alive) return;
        setManifest(data);
        const initialLoaded: Record<number, boolean> = {};
        for (const organ of data.organs) initialLoaded[organ.id] = true;
        setLoaded(initialLoaded);
      })
      .catch(() => {
        if (alive) setUnavailable(true);
      });
    return () => { alive = false; };
  }, [caseId]);

  const organs = useMemo(() => manifest?.organs ?? [], [manifest]);

  if (unavailable) {
    return <div>3D segmentation unavailable</div>;
  }
  if (!manifest || loading || !checkState || checkState.length === 0) {
    return <div>Loading 3D segmentation...</div>;
  }
  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <main style={{ flex: 1, minWidth: 0 }}>
      <Canvas
          camera={{ position: [0, 250, 650], fov: 45, near: 0.1, far: 5000 }}
          gl={{ preserveDrawingBuffer: true }}
        >
          <color attach="background" args={["#050505"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[300, 500, 300]} intensity={1.2} />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.2}>
              <group>
                {organs.map((organ) => {
                  if (!loaded[organ.id]) return null;
                  // Edited static organ: the server-baked GLB is stale — extract a
                  // fresh live mesh from the in-memory labelmap instead, same path
                  // custom classes already use.
                  if (editedSegments.has(organ.id)) {
                    return (
                      <LiveSegmentMesh
                        key={`live-${organ.id}`}
                        segmentIndex={organ.id}
                        color={labelColorMap[organ.id] ?? [255, 255, 255, 255]}
                        visible={!!checkState[organ.id]}
                        opacity={opacity / 100}
                        manifestCenter={manifest.center as [number, number, number]}
                      />
                    );
                  }
                  return (
                    <OrganMesh
                      key={organ.id}
                      organ={organ}
                      visible={!!checkState[organ.id]}
                      opacity={opacity/100}
                      color={labelColorMap[organ.id]}
                    />
                  );
                })}
                {customOrgans.map((organ) => (
                  <LiveSegmentMesh
                    key={organ.id}
                    segmentIndex={organ.id}
                    color={labelColorMap[organ.id] ?? [255, 255, 255, 255]}
                    visible={!!checkState[organ.id]}
                    opacity={opacity / 100}
                    manifestCenter={manifest.center as [number, number, number]}
                  />
                ))}
              </group>
            </Bounds>
            {crosshairPosition && manifest.bounds && (
              <SceneCrosshair3D position={crosshairPosition} bounds={manifest.bounds} />
            )}
          </Suspense>
          <OrbitControls makeDefault />
        </Canvas>
      </main>
    </div>
  );
}

import { useEffect, useState } from "react";
import * as THREE from "three";
import type { Color } from "@cornerstonejs/core/types";
import { extractSegmentSurface, subscribeToSegmentationEdits } from "../helpers/CornerstoneNifti2";
import { debounce } from "../helpers/debounce";
import { rgbToHex } from "./OrganMesh";

type LiveSegmentMeshProps = {
  segmentIndex: number;
  color: Color;
  visible: boolean;
  opacity: number;
  manifestCenter: [number, number, number];
};

// Live, client-side isosurface for a custom class — rebuilt from the current
// labelmap voxels whenever painting pauses. No server round-trip; no save
// required. Positioned in the same Three.js scene space as the pre-baked
// organ GLBs (see extractSegmentSurface's transform comments).
export function LiveSegmentMesh({ segmentIndex, color, visible, opacity, manifestCenter }: LiveSegmentMeshProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;

    const rebuild = () => {
      const result = extractSegmentSurface(segmentIndex, manifestCenter);
      if (cancelled) return;
      if (!result) {
        setGeometry(null);
        return;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(result.indices, 1));
      geo.computeVertexNormals();
      setGeometry(geo);
    };

    rebuild(); // paint may already exist when this mounts (e.g. toggling 3D on)
    const debouncedRebuild = debounce(rebuild, 400);
    const unsubscribe = subscribeToSegmentationEdits(debouncedRebuild);

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentIndex, manifestCenter[0], manifestCenter[1], manifestCenter[2]]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} visible={visible}>
      <meshStandardMaterial
        color={new THREE.Color(rgbToHex(color[0], color[1], color[2], color[3]))}
        roughness={0.75}
        metalness={0}
        transparent={opacity < 1}
        opacity={opacity}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
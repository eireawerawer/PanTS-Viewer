import { useRef, useState, type MouseEvent } from "react";
import {
	canvasPointToVoxel,
	runDualScribbleFill,
	type CinePane,
	type SliceInfo,
} from "../CornerstoneNifti2";

type ScribblePoint = { pos: [number, number]; slice: number };
type PanePreview = { fg: ScribblePoint[]; bg: ScribblePoint[] };

const EMPTY_PREVIEW: Record<CinePane, PanePreview> = {
	axial: { fg: [], bg: [] },
	sagittal: { fg: [], bg: [] },
	coronal: { fg: [], bg: [] },
};

interface UseSmartFillArgs {
	/** Only active while the caller's edit mode is "smartfill". */
	enabled: boolean;
	/** Read the current slice index per pane (kept as a ref by the caller so
	 *  this hook doesn't need to re-render on every slice change). */
	sliceInfoRef: React.MutableRefObject<Record<CinePane, SliceInfo | null>>;
	/** Optional reading-session logger. */
	onLog?: (detail: string) => void;
}

/**
 * Click-and-drag scribble segmentation: mark foreground (cyan) and background
 * (red) voxels on any pane, then apply a dual-scribble fill that grows the
 * foreground region away from the background markers. Scope can be locked to
 * the pane/slice the scribbles started on, or applied across the whole volume.
 */
export function useSmartFill({ enabled, sliceInfoRef, onLog }: UseSmartFillArgs) {
	const [markMode, setMarkMode] = useState<"fg" | "bg">("fg");
	const [scope, setScope] = useState<"slice" | "volume">("slice");
	const [preview, setPreview] = useState<Record<CinePane, PanePreview>>(EMPTY_PREVIEW);

	const scribbleActiveRef = useRef(false);
	const fgVoxelsRef = useRef<[number, number, number][]>([]);
	const bgVoxelsRef = useRef<[number, number, number][]>([]);
	const paneRef = useRef<CinePane | null>(null);

	const clearScribbles = () => {
		fgVoxelsRef.current = [];
		bgVoxelsRef.current = [];
		paneRef.current = null;
		setPreview(EMPTY_PREVIEW);
	};

	const addPoint = (pane: CinePane, e: MouseEvent) => {
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const canvasPos: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
		const voxel = canvasPointToVoxel(pane, canvasPos);
		if (!voxel) return;

		paneRef.current = pane;
		(markMode === "fg" ? fgVoxelsRef : bgVoxelsRef).current.push(voxel);

		const sliceIdx = sliceInfoRef.current[pane]?.current ?? -1;
		setPreview((prev) => ({
			...prev,
			[pane]: {
				...prev[pane],
				[markMode]: [...prev[pane][markMode], { pos: canvasPos, slice: sliceIdx }],
			},
		}));
	};

	const apply = () => {
		const fg = fgVoxelsRef.current;
		const bg = bgVoxelsRef.current;
		if (!fg.length || !bg.length) return;

		const sliceLock = scope === "slice" && paneRef.current ? { pane: paneRef.current } : null;
		const result = runDualScribbleFill(fg, bg, { sliceLock });
		if (result) onLog?.(`Smart fill: ${result.filledVoxels.toLocaleString()} voxels`);
		clearScribbles();
	};

	const handleMouseDown = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled) return;
		e.preventDefault();
		scribbleActiveRef.current = true;
		addPoint(pane, e);
	};
	const handleMouseMove = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled || !scribbleActiveRef.current) return;
		addPoint(pane, e);
	};
	const handleMouseUp = () => {
		scribbleActiveRef.current = false;
	};

	return {
		markMode,
		setMarkMode,
		scope,
		setScope,
		preview,
		handleMouseDown,
		handleMouseMove,
		handleMouseUp,
		apply,
		clearScribbles,
	};
}
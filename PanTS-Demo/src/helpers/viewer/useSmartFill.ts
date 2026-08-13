import { useRef, useState, type MouseEvent } from "react";
import {
	canvasPointToVoxel,
	runDualScribbleFill,
	pushEditHistory,
	type CinePane,
	type SliceInfo,
	type MaskFilter,
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
	/** Global "applies to" masking predicate — same one every other tool uses. */
	maskFilter: MaskFilter;
	/** Optional reading-session logger. */
	onLog?: (detail: string) => void;
}

/**
 * Click-and-drag scribble segmentation: mark foreground (cyan) and background
 * (red) voxels on any pane, then apply a dual-scribble fill that grows the
 * foreground region away from the background markers. Scope can be locked to
 * the pane/slice the scribbles started on, or applied across the whole volume.
 */
export function useSmartFill({ enabled, sliceInfoRef, maskFilter, onLog }: UseSmartFillArgs) {
	const [markMode, setMarkMode] = useState<"fg" | "bg">("fg");
	const [scope, setScope] = useState<"slice" | "volume">("slice");
	const [preview, setPreview] = useState<Record<CinePane, PanePreview>>(EMPTY_PREVIEW);

	const scribbleActiveRef = useRef(false);
	const fgVoxelsRef = useRef<[number, number, number][]>([]);
	const bgVoxelsRef = useRef<[number, number, number][]>([]);
	const paneRef = useRef<CinePane | null>(null);

	// Mirrors `preview` so stroke bookkeeping can read the latest value
	// synchronously (state updates are async/batched, refs aren't).
	const previewRef = useRef(preview);
	const updatePreview = (next: Record<CinePane, PanePreview>) => {
		previewRef.current = next;
		setPreview(next);
	};

	// Captures everything needed to undo/redo one whole click-and-drag
	// stroke as a single step — not one undo per pixel, the same way a
	// brush stroke undoes as one action rather than one per sampled point.
	const strokeRef = useRef<{
		mode: "fg" | "bg";
		pane: CinePane;
		voxelStart: number;
		previewStart: number;
	} | null>(null);

	const clearScribbles = () => {
		fgVoxelsRef.current = [];
		bgVoxelsRef.current = [];
		paneRef.current = null;
		updatePreview(EMPTY_PREVIEW);
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
		updatePreview({
			...previewRef.current,
			[pane]: {
				...previewRef.current[pane],
				[markMode]: [...previewRef.current[pane][markMode], { pos: canvasPos, slice: sliceIdx }],
			},
		});
	};

	const apply = () => {
		const fg = fgVoxelsRef.current;
		const bg = bgVoxelsRef.current;
		if (!fg.length || !bg.length) return;

		const sliceLock = scope === "slice" && paneRef.current ? { pane: paneRef.current } : null;
		const result = runDualScribbleFill(fg, bg, { sliceLock, maskFilter });
		if (result) onLog?.(`Smart fill: ${result.filledVoxels.toLocaleString()} voxels`);
		clearScribbles();
	};

	const handleMouseDown = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled) return;
		e.preventDefault();
		scribbleActiveRef.current = true;
		strokeRef.current = {
			mode: markMode,
			pane,
			voxelStart: (markMode === "fg" ? fgVoxelsRef : bgVoxelsRef).current.length,
			previewStart: previewRef.current[pane][markMode].length,
		};
		addPoint(pane, e);
	};
	const handleMouseMove = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled || !scribbleActiveRef.current) return;
		addPoint(pane, e);
	};
	const handleMouseUp = () => {
		scribbleActiveRef.current = false;
		const stroke = strokeRef.current;
		strokeRef.current = null;
		if (!stroke) return;

		const { mode, pane, voxelStart, previewStart } = stroke;
		const voxelsRef = mode === "fg" ? fgVoxelsRef : bgVoxelsRef;
		const addedVoxels = voxelsRef.current.slice(voxelStart);
		const addedPreview = previewRef.current[pane][mode].slice(previewStart);
		if (!addedVoxels.length) return; // clicked but no valid voxel under the cursor

		pushEditHistory({
			undo: () => {
				voxelsRef.current = voxelsRef.current.slice(0, voxelStart);
				updatePreview({
					...previewRef.current,
					[pane]: { ...previewRef.current[pane], [mode]: previewRef.current[pane][mode].slice(0, previewStart) },
				});
			},
			redo: () => {
				voxelsRef.current = [...voxelsRef.current, ...addedVoxels];
				updatePreview({
					...previewRef.current,
					[pane]: { ...previewRef.current[pane], [mode]: [...previewRef.current[pane][mode], ...addedPreview] },
				});
			},
		});
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
		hasForegroundMarks: fgVoxelsRef.current.length > 0,
		hasBackgroundMarks: bgVoxelsRef.current.length > 0,
	};
}
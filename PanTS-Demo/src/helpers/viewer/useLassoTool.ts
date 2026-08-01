import { useRef, useState, type MouseEvent } from "react";
import { lassoCommitPolygon, type CinePane } from "../CornerstoneNifti2";

interface UseLassoToolArgs {
	/** Only active while the caller's edit mode is "lasso". */
	enabled: boolean;
	onLog?: (detail: string) => void;
}

/**
 * Plain point-and-click polygon lasso: click to drop anchor points on a
 * single pane, then close the loop to fill the enclosed region. Deliberately
 * has no magnetic/edge-snapping — straight lines between clicked points only.
 */
export function useLassoTool({ enabled, onLog }: UseLassoToolArgs) {
	const [anchorsCanvas, setAnchorsCanvas] = useState<Array<[number, number]>>([]);
	const [livePreview, setLivePreview] = useState<[number, number] | null>(null);
	const paneRef = useRef<CinePane | null>(null);

	const reset = () => {
		setAnchorsCanvas([]);
		setLivePreview(null);
		paneRef.current = null;
	};

	const handleClick = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const pos: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];

		if (!paneRef.current) {
			paneRef.current = pane;
			setAnchorsCanvas([pos]);
			return;
		}
		// One polygon lives on one pane at a time — ignore clicks elsewhere until
		// this one is closed or cancelled.
		if (paneRef.current !== pane) return;
		setAnchorsCanvas((prev) => [...prev, pos]);
	};

	const handleMouseMove = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled || paneRef.current !== pane || !anchorsCanvas.length) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		setLivePreview([e.clientX - rect.left, e.clientY - rect.top]);
	};

	const undo = () => {
		if (anchorsCanvas.length <= 1) {
			reset();
			return;
		}
		setAnchorsCanvas((prev) => prev.slice(0, -1));
	};

	const cancel = () => reset();

	const close = () => {
		const pane = paneRef.current;
		if (!pane || anchorsCanvas.length < 3) {
			onLog?.("Lasso: need at least 3 points before closing.");
			return;
		}
		const result = lassoCommitPolygon(pane, anchorsCanvas);
		if (result?.filledVoxels) {
			onLog?.(`Lasso fill (${result.filledVoxels.toLocaleString()} vox)`);
		} else {
			onLog?.("Lasso: no voxels filled — try a larger loop.");
		}
		reset();
	};

	return {
		pane: paneRef.current,
		anchorsCanvas,
		livePreview,
		handleClick,
		handleMouseMove,
		undo,
		cancel,
		close,
		reset,
	};
}
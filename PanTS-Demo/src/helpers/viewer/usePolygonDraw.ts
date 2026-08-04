// helpers/viewer/usePolygonDraw.ts
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { CinePane } from "../CornerstoneNifti2";

const CLOSE_CLICK_RADIUS_PX = 10;

interface UsePolygonDrawArgs {
	enabled: boolean;
	/** Called with the DENSE fill path (every pixel along every leg, including
	 *  any live-wire detours) once the shape is closed — this is what actually
	 *  gets rasterized/filled. */
	onClose: (pane: CinePane, points: Array<[number, number]>) => void;
	/** Optional "live wire" hook (e.g. the magnetic edge-snap tool). Given the
	 *  pane and the last fastening point + the current cursor point, returns a
	 *  dense path from `from` to `to` (inclusive) that hugs nearby intensity
	 *  edges — or null/undefined to fall back to a straight line between the
	 *  two points. Used both for the live preview between clicks and to bake
	 *  the actual leg in once the user clicks to drop the next fastening
	 *  point, exactly like Photoshop's magnetic lasso: the cursor doesn't need
	 *  to trace the boundary exactly, the path snaps to it between clicks. */
	computeLivePath?: (
		pane: CinePane,
		from: [number, number],
		to: [number, number]
	) => Array<[number, number]> | null | undefined;
}

export function usePolygonDraw({ enabled, onClose, computeLivePath }: UsePolygonDrawArgs) {
	// Dense fill path — every pixel along every committed leg (corners plus,
	// when computeLivePath is active, whatever detour the live wire took to
	// hug an edge between two corners). This is what gets filled/cut.
	const [points, setPoints] = useState<Array<[number, number]>>([]);
	// Just the clicked "fastening points" — used for the corner dots and for
	// screen-space close-click detection, independent of any live-wire detour.
	const [corners, setCorners] = useState<Array<[number, number]>>([]);
	// How many dense points each leg (ending at corners[i+1]) contributed to
	// `points`, so undo() can pop exactly one leg's worth back off.
	const legLengthsRef = useRef<number[]>([]);
	const [livePreview, setLivePreview] = useState<[number, number] | null>(null);
	const [livePreviewPath, setLivePreviewPath] = useState<Array<[number, number]> | null>(null);
	// True when the cursor is currently within closing range of the first point —
	// drives the "click here to close" highlight on the start anchor.
	const [nearClose, setNearClose] = useState(false);
	const paneRef = useRef<CinePane | null>(null);

	const reset = useCallback(() => {
		setPoints([]);
		setCorners([]);
		legLengthsRef.current = [];
		setLivePreview(null);
		setLivePreviewPath(null);
		setNearClose(false);
		paneRef.current = null;
	}, []);

	useEffect(() => {
		if (!enabled) reset();
	}, [enabled, reset]);

	const close = useCallback(() => {
		const pane = paneRef.current;
		if (!pane || corners.length < 3) return;
		// Bake the closing leg (last corner back to the start) into the dense
		// path too, so a magnetic/live-wire close hugs the boundary just like
		// every other leg instead of snapping back with a straight line.
		const last = corners[corners.length - 1];
		const first = corners[0];
		const closingLeg = computeLivePath?.(pane, last, first);
		const closingPoints = closingLeg && closingLeg.length >= 2 ? closingLeg.slice(1) : [first];
		onClose(pane, [...points, ...closingPoints]);
		reset();
	}, [points, corners, computeLivePath, onClose, reset]);

	const handleClick = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const rawPos: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];

		if (!paneRef.current) {
			paneRef.current = pane;
			setPoints([rawPos]);
			setCorners([rawPos]);
			legLengthsRef.current = [];
			return;
		}
		if (paneRef.current !== pane) return;

		// Close-click detection always uses the raw cursor position against the
		// raw start corner — a live-wire detour shouldn't change where "click
		// here to close" actually is on screen.
		if (corners.length >= 3) {
			const [fx, fy] = corners[0];
			if (Math.hypot(rawPos[0] - fx, rawPos[1] - fy) < CLOSE_CLICK_RADIUS_PX) {
				close();
				return;
			}
		}

		const last = corners[corners.length - 1];
		const leg = computeLivePath?.(pane, last, rawPos);
		const legPoints = leg && leg.length >= 2 ? leg.slice(1) : [rawPos];
		legLengthsRef.current = [...legLengthsRef.current, legPoints.length];
		setPoints((prev) => [...prev, ...legPoints]);
		setCorners((prev) => [...prev, rawPos]);
	};

	const handleDoubleClick = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled || paneRef.current !== pane) return;
		e.preventDefault();
		close();
	};

	const handleMouseMove = (pane: CinePane) => (e: MouseEvent) => {
		if (!enabled || paneRef.current !== pane || !corners.length) return;
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const rawPos: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
		setLivePreview(rawPos);

		const last = corners[corners.length - 1];
		const preview = computeLivePath?.(pane, last, rawPos);
		setLivePreviewPath(preview && preview.length >= 2 ? preview : [last, rawPos]);

		if (corners.length >= 3) {
			const [fx, fy] = corners[0];
			setNearClose(Math.hypot(rawPos[0] - fx, rawPos[1] - fy) < CLOSE_CLICK_RADIUS_PX);
		}
	};

	const undo = () => {
		if (corners.length <= 1) { reset(); return; }
		const lastLegLen = legLengthsRef.current[legLengthsRef.current.length - 1] ?? 0;
		legLengthsRef.current = legLengthsRef.current.slice(0, -1);
		setPoints((prev) => prev.slice(0, prev.length - lastLegLen));
		setCorners((prev) => prev.slice(0, -1));
	};

	useEffect(() => {
		if (!enabled) return;
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
			if (e.key === "Escape" && corners.length) { e.preventDefault(); reset(); }
			else if (e.key === "Enter" && corners.length >= 3) { e.preventDefault(); close(); }
			// Ctrl/Cmd+Z removes the last placed point, one at a time — replaces
			// the old "Undo point" button in the flyout with the shortcut users
			// actually reach for.
			else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && corners.length) {
				e.preventDefault();
				undo();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled, corners, reset, close]);

	return {
		pane: paneRef.current,
		points,
		corners,
		livePreview,
		livePreviewPath,
		nearClose,
		handleClick,
		handleDoubleClick,
		handleMouseMove,
		undo,
		cancel: reset,
		reset,
	};
}
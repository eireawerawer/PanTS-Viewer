import { useCallback, useEffect, useRef, useState } from "react";

interface Pos {
	x: number;
	y: number;
}

interface Size {
	width: number;
	height: number;
}

interface Options {
	initial: Pos;
	expandedSize: Size;
	minimizedSize?: Size;
	marginX?: number;
	marginY?: number;
	anchorBottom?: boolean;
	/**
	 * When true, horizontal dragging is clamped flush to the viewport's
	 * left/right edges (margin is treated as 0 on the X axis) instead of
	 * allowing the panel to hang partway off-screen. Vertical clamping is
	 * unaffected by this flag.
	 */
	lockToScreenEdges?: boolean;
}

/**
 * Shared drag/minimize/clamp behavior for every floating panel in the
 * annotation UI (tool dock, segments popup, tool option panels, ...).
 *
 * Panels are clamped to stay on-screen whenever they're actually moved
 * (dragged, or expanded/minimized), but a panel's position is otherwise
 * left alone — in particular it does NOT reclamp on window "resize". That
 * used to happen and caused a visible jump any time the viewport's layout
 * width changed without the user touching the panel at all, e.g. opening
 * browser devtools or an in-app side console. Panels now stay exactly
 * where the user left them (or at their default position) across that
 * kind of resize.
 */
export function useDraggablePanel({
	initial,
	expandedSize,
	minimizedSize = { width: 160, height: 46 },
	marginX = -30,
	marginY = 12,
	anchorBottom = false,
	lockToScreenEdges = false,
}: Options) {
	const [pos, setPos] = useState<Pos>(initial);
	const [minimized, setMinimized] = useState(false);

	const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
	const minimizedRef = useRef(minimized);
	minimizedRef.current = minimized;

	const clamp = useCallback(
		(p: Pos, mini: boolean): Pos => {
			// Horizontal: honor the panel's actual current width (mini vs expanded
			// can legitimately differ in width). When lockToScreenEdges is set,
			// never let it hang off-screen — the whole point of a dock is that
			// dragging it resolves to flush against the left or right edge.
			//
			// Use clientWidth (excludes the scrollbar) rather than innerWidth
			// (includes it) — a fixed-position element clamped against
			// innerWidth sits partly behind the scrollbar, leaving a visible
			// gap on the real right edge of the page content.
			const viewportWidth = typeof document !== "undefined" ? document.documentElement.clientWidth : window.innerWidth;
			const width = mini ? minimizedSize.width : expandedSize.width;
			const effMarginX = lockToScreenEdges ? 0 : marginX;
			const maxX = Math.max(effMarginX, viewportWidth - width - effMarginX);

			// Vertical: ALWAYS reserve room for the expanded height, even while
			// currently minimized. Otherwise a panel dragged near the bottom
			// edge while minimized can later be expanded into a position where
			// its lower icons/content render off-screen and become unreachable.
			const height = expandedSize.height;
			let minY = marginY;
			let maxY = window.innerHeight - marginY;
			if (anchorBottom) {
				minY = height + marginY;
				maxY = window.innerHeight - marginY;
			} else {
				maxY = Math.max(marginY, window.innerHeight - height - marginY);
			}

			return {
				x: Math.min(Math.max(p.x, effMarginX), maxX),
				y: Math.min(Math.max(p.y, minY), maxY),
			};
		},
		[expandedSize.width, expandedSize.height, minimizedSize.width, minimizedSize.height, marginX, marginY, anchorBottom, lockToScreenEdges]
	);

	// Re-clamp whenever the panel is minimized/expanded (its effective size
	// just changed), but intentionally NOT on window resize — see the
	// doc comment above.
	useEffect(() => {
		setPos((p) => clamp(p, minimized));
	}, [minimized, clamp]);

	const onPointerMove = useCallback(
		(e: PointerEvent) => {
			if (!dragState.current) return;
			const { startX, startY, origX, origY } = dragState.current;
			const next = { x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) };
			setPos(clamp(next, minimizedRef.current));
		},
		[clamp]
	);

	const onPointerUp = useCallback(() => {
		dragState.current = null;
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", onPointerUp);
	}, [onPointerMove]);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", onPointerUp);
		},
		[pos, onPointerMove, onPointerUp]
	);

	// Safety net: if the component unmounts mid-drag, don't leak listeners.
	useEffect(
		() => () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
		},
		[onPointerMove, onPointerUp]
	);

	return { pos, minimized, setMinimized, dragHandleProps: { onPointerDown } };
}
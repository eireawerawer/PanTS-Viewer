import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
	IconBrush,
	IconEraser,
	IconScissors,
	IconRipple,
	IconArrowsDiagonal,
	IconDroplet,
	IconMathFunction,
	IconWand,
	IconStack2,
	IconCopy,
	IconWaveSine,
	IconGripVertical,
	IconMinus,
	IconChevronsUp,
	IconCircleDashed,
} from "@tabler/icons-react";
import "./AnnotationToolbar.css";
import { useDraggablePanel } from "../../helpers/viewer/useDraggablePanel";
import MaskingSelect, { type MaskingArea } from "../segmentation/MaskingSelect";
import NumberSliderField from "../NumberSliderField";
import ToolWalkthrough, { WalkthroughLauncherButton } from "../walkthrough/ToolWalkthrough";
import { buildToolSteps, buildOverviewSteps, type OverviewRects } from "../walkthrough/WalkthroughContent";

// Shared across the whole app: once the overview tour has been shown (either
// automatically on first open, or manually via replay-then-dismiss), it
// won't auto-pop again on future visits — the "Show walkthrough" launcher in
// the dock header remains the way to bring it back up any time.
const OVERVIEW_WALKTHROUGH_SEEN_KEY = "mm_annotation_walkthrough_seen";

export type PrimaryEditTool =
	| "paint" | "erase" | "scissors" | "levelTracing"
	| "margin" | "smoothing" | "islands" | "logicalOperators"
	| "growFromSeeds" | "fillBetweenSlices" | "copyAcrossSlices" | "hollow"
	| null;
export type ScissorsOperation = "eraseInside" | "eraseOutside" | "fillInside" | "fillOutside";
export type ScissorsSliceCut = "unlimited" | "positive" | "negative" | "symmetric";

export interface ScissorsOptions {
	operation: ScissorsOperation;
	/** Magnetic edge snap — when on, each placed point (and the live preview
	 *  point) snaps to the nearest strong intensity edge within a small radius,
	 *  like Photoshop's magnetic lasso. Makes it much easier to trace
	 *  high-contrast organ/bone boundaries without hand-placing every point. */
	magnetEnabled?: boolean;
}

interface AnnotationToolbarProps {
	open: boolean;
	hasSegments: boolean;
	hasActiveTarget: boolean;
	activeTool: PrimaryEditTool;
	onToolChange: (tool: PrimaryEditTool) => void;
	diameterMm: number;
	onDiameterChange: (mm: number) => void;
	onDiameterPreviewChange?: (active: boolean) => void;
	scissorsOptions: ScissorsOptions;
	onScissorsOptionsChange: (opts: ScissorsOptions) => void;
	scissorsPointCount: number;
	onScissorsCancel: () => void;
	maskingArea: MaskingArea;
	onMaskingAreaChange: (v: MaskingArea) => void;
	hasAnySegments: boolean;
	scopeLocked?: boolean;
	/** True while a paint/erase/scissors edit is actively being committed —
	 *  drives a small pulsing dot in the panel header so lag never reads as
	 *  "nothing happened". */
	isRendering?: boolean;

	renderFlyout: (tool: Exclude<PrimaryEditTool, null>) => React.ReactNode;

	popupRef?: React.RefObject<HTMLDivElement | null>;
	popupDragRef?: React.RefObject<HTMLDivElement | null>;
	popupMinRef?: React.RefObject<HTMLButtonElement | null>;
	sliceJumpRef?: React.RefObject<HTMLDivElement | null>;
	overviewExtraRects?: OverviewRects;

	
}

const TOOL_DEFS: Array<{ id: Exclude<PrimaryEditTool, null>; label: string; Icon: any; description: string }> = [
	{ id: "paint", label: "Brush", Icon: IconBrush, description: "Paint with a round brush." },
	{ id: "erase", label: "Erase", Icon: IconEraser, description: "Erase with a round brush." },
	{ id: "scissors", label: "Scissors", Icon: IconScissors, description: "Cut through the entire segment from the current viewpoint." },
	{ id: "levelTracing", label: "Level Tracing", Icon: IconRipple, description: "Trace the boundary of similar intensity around the cursor." },
	{ id: "margin", label: "Margin", Icon: IconArrowsDiagonal, description: "Grow or shrink selected segment by specified margin size." },
	{ id: "smoothing", label: "Smoothing", Icon: IconWaveSine, description: "Make segment boundaries smoother." },
	{ id: "islands", label: "Islands", Icon: IconDroplet, description: "Edit islands (connected components) in a segment." },
	{ id: "logicalOperators", label: "Logical operators", Icon: IconMathFunction, description: "Apply logical operators or combine segments." },
	{ id: "growFromSeeds", label: "Grow from seeds", Icon: IconWand, description: "Grow segments from user-placed seed scribbles." },
	{ id: "fillBetweenSlices", label: "Fill between slices", Icon: IconStack2, description: "Interpolate segment shape between two annotated slices." },
	{ id: "copyAcrossSlices", label: "Copy across slices", Icon: IconCopy, description: "Copy the segment's shape from one slice across a range." },
	{ id: "hollow", label: "Hollow", Icon: IconCircleDashed, description: "Make the segment hollow by replacing it with a uniform-thickness shell." },
];

const SCISSORS_OPERATIONS: { value: ScissorsOperation; label: string }[] = [
	{ value: "eraseInside", label: "Erase inside" },
	{ value: "eraseOutside", label: "Erase outside" },
	{ value: "fillInside", label: "Fill inside" },
	{ value: "fillOutside", label: "Fill outside" },
];

// Tools that don't have an ApplyButton — they commit directly on pointer
// interaction, so the rendering dot is the only feedback available.
const LIVE_COMMIT_TOOLS: Exclude<PrimaryEditTool, null>[] = ["paint", "erase", "scissors", "levelTracing"];

const MIN_DIAMETER_MM = 2;
const MAX_DIAMETER_MM = 40;

// Dock width matches its CSS (.atb--vertical: 6px*2 padding + 55px buttons =
// 67px, rounded to 68). Exported so SegmentsPopup can size its own default
// resting position off the same number instead of duplicating a magic
// constant that could silently drift out of sync.
export const ANNOTATION_DOCK_WIDTH = 68;

function ScissorsOpIcon({ op }: { op: ScissorsOperation }) {
	const fill = op === "fillInside" || op === "fillOutside";
	const inside = op === "eraseInside" || op === "fillInside";
	return (
		<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
			<rect x="1" y="1" width="18" height="18" rx="3" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
			<circle
				cx="10" cy="10" r="6"
				fill={inside && fill ? "#fff" : "none"}
				stroke="#fff"
				strokeWidth="1.4"
				strokeDasharray={inside ? "0" : "2,2"}
			/>
			{!inside && fill && (
				<path d="M1 1 H19 V19 H1 Z M4 4 A6 6 0 0 1 16 4 A6 6 0 0 1 16 16 A6 6 0 0 1 4 16 A6 6 0 0 1 4 4 Z"
					fill="#fff" fillRule="evenodd" opacity="0.9" />
			)}
		</svg>
	);
}

// Magnet icon: a horseshoe magnet with two little "attraction" arcs pulling
// toward the poles — reused as the checkbox glyph and standalone next to the
// "Magnetic edge snap" label so the toggle reads at a glance even before
// hovering for the tooltip.
function MagnetIcon({ active }: { active?: boolean }) {
	const stroke = active ? "#08090b" : "#fff";
	return (
		<svg width="16" height="16" viewBox="0 0 20 20" fill="none">
			<path
				d="M6 3 L6 10 A4 4 0 0 0 14 10 L14 3"
				stroke={stroke}
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<path d="M6 3 H3 V7 H6" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
			<path d="M14 3 H17 V7 H14" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
			<path d="M2.5 12.5 L4.5 11.2 M17.5 12.5 L15.5 11.2" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" opacity="0.6" />
		</svg>
	);
}

// Drop-in replacement for `DiameterFlyout` in AnnotationToolbar.tsx.
// Same props/behavior (live preview while dragging), now using the shared
// NumberSliderField so the pen/eraser diameter box behaves like every other
// typable field: one number shown once, unit beside it, decimals typable.
//
// Add this import near the top of AnnotationToolbar.tsx:
//   import NumberSliderField from "./NumberSliderField";
// then replace the existing `function DiameterFlyout(...) { ... }` with this.

function DiameterFlyout({
	title, diameterMm, onDiameterChange, onPreviewChange, fieldRef,
}: {
	title: string;
	diameterMm: number;
	onDiameterChange: (mm: number) => void;
	onPreviewChange?: (active: boolean) => void;
	/** Wraps the slider field so the walkthrough can spotlight its live rect. */
	fieldRef?: React.RefObject<HTMLDivElement>;
}) {
	return (
		<div className="seg-effect">
			<div ref={fieldRef}>
				<NumberSliderField
					label={title}
					value={diameterMm}
					onChange={onDiameterChange}
					min={MIN_DIAMETER_MM}
					max={MAX_DIAMETER_MM}
					step={0.5}
					unit="mm"
					ariaLabel={`${title} diameter`}
					onPreviewChange={onPreviewChange}
				/>
			</div>
		</div>
	);
}

function ScissorsFlyout({ options, onChange, pointCount, onCancel }: {
	options: ScissorsOptions;
	onChange: (opts: ScissorsOptions) => void;
	pointCount: number;
	onCancel: () => void;
}) {
	const set = <K extends keyof ScissorsOptions>(key: K, value: ScissorsOptions[K]) =>
		onChange({ ...options, [key]: value });

	return (
		<div className="seg-effect">
			<div className="atb-flyout__grid atb-flyout__grid--scissors">
				<div className="atb-flyout__col">
					<span className="atb-flyout__label">Operation:</span>
					{SCISSORS_OPERATIONS.map((op) => (
						<label className="atb-flyout__radio" key={op.value}>
							<input
								type="radio"
								name="scissors-op"
								checked={options.operation === op.value}
								onChange={() => set("operation", op.value)}
							/>
							<ScissorsOpIcon op={op.value} />
							{op.label}
						</label>
					))}
				</div>
				<label className="atb-flyout__checkbox atb-flyout__span-all atb-flyout__magnet-toggle">
					<input
						type="checkbox"
						checked={!!options.magnetEnabled}
						onChange={(e) => set("magnetEnabled", e.target.checked)}
					/>
					<MagnetIcon active={options.magnetEnabled} />
					Magnetic edge snap
				</label>
				<div className="atb-flyout__span-all atb-flyout__draw-actions">
					<button type="button" className="atb-flyout__draw-btn atb-flyout__draw-btn--cancel" disabled={pointCount === 0} onClick={onCancel}>
						Cancel shape
					</button>
				</div>
				<div className="atb-flyout__hint atb-flyout__span-all">
				Draw a shape, then click back on the <span className="atb-flyout__hint-dot" /> red start point to close it. Ctrl+Z undoes the last point.
				{options.magnetEnabled && " The edge hugs nearby boundaries between clicks, like Photoshop's magnetic lasso."}
				</div>
			</div>
		</div>
	);
}

// Portal-rendered tooltip — rendered to document.body and positioned via
// getBoundingClientRect of the hovered icon, so it's never clipped by the
// dock's own overflow:hidden/auto rules.
function IconTooltip({
	label, description, anchorRect,
}: {
	label: string;
	description: string;
	anchorRect: DOMRect | null;
}) {
	if (!anchorRect) return null;
	return createPortal(
		<div
			style={{
				position: "fixed",
				top: anchorRect.top + anchorRect.height / 2,
				left: anchorRect.left - 10,
				transform: "translate(-100%, -50%)",
				background: "#fff",
				color: "#111",
				borderRadius: 8,
				padding: "8px 10px",
				minWidth: 160,
				maxWidth: 240,
				boxShadow: "0 8px 24px -6px rgba(0,0,0,0.45)",
				zIndex: 500,
				pointerEvents: "none",
				fontFamily: "system-ui, sans-serif",
				whiteSpace: "normal",
			}}
		>
			<div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 2 }}>{label}</div>
			<div style={{ fontSize: 11.5, lineHeight: 1.35, color: "#333" }}>{description}</div>
		</div>,
		document.body
	);
}

// Small pulsing dot — the only feedback for live-commit tools (paint/erase/
// scissors) since they have no ApplyButton. Lives in the panel header next
// to the tool name so it's visible without adding any body text.
function RenderingIndicator() {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				fontSize: 10.5,
				color: "rgba(255,255,255,0.65)",
				flexShrink: 0,
			}}
		>
			<span
				aria-hidden="true"
				style={{
					width: 7,
					height: 7,
					borderRadius: "50%",
					background: "#6ea8fe",
					animation: "seg-effect-render-pulse 0.9s ease-in-out infinite",
				}}
			/>
			Loading...
		</span>
	);
}
export default function AnnotationToolbar({
	open, hasSegments, hasActiveTarget, activeTool, onToolChange,
	diameterMm, onDiameterChange, onDiameterPreviewChange, scissorsOptions, onScissorsOptionsChange,
	renderFlyout, scissorsPointCount, onScissorsCancel, maskingArea,
	onMaskingAreaChange, hasAnySegments, scopeLocked, isRendering,
	popupRef, popupDragRef, popupMinRef, sliceJumpRef, overviewExtraRects,
}: AnnotationToolbarProps) {
	const [hoveredTool, setHoveredTool] = useState<string | null>(null);
	const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
	const [dockMinimized, setDockMinimized] = useState(false);
	const iconRefs = useRef<Record<string, HTMLElement | null>>({});

	// --- Walkthroughs --------------------------------------------------------
	// Every tool gets an identical "Show walkthrough" launcher in its panel
	// header (toolWalkthroughOpen). There's also one Overview walkthrough,
	// launched from the dock, that tours the dock + corner panel dragging/
	// minimizing (the segments-popup portion is filled in by the caller via
	// `overviewExtraRects`, since the popup lives outside this component).
	// Reopening either after dismissal — the launcher button never goes away
	// — is the entire "replay" mechanism; no separate control is needed.
	const [toolWalkthroughOpen, setToolWalkthroughOpen] = useState(false);
	const [overviewWalkthroughOpen, setOverviewWalkthroughOpen] = useState(false);
	const [fieldRect, setFieldRect] = useState<DOMRect | null>(null);
	const [maskingRect, setMaskingRect] = useState<DOMRect | null>(null);
	const [panelRect, setPanelRect] = useState<DOMRect | null>(null);
	const [panelDragRect, setPanelDragRect] = useState<DOMRect | null>(null);
	const [dockRect, setDockRect] = useState<DOMRect | null>(null);
	const [dockDragRect, setDockDragRect] = useState<DOMRect | null>(null);
	const [dockMinRect, setDockMinRect] = useState<DOMRect | null>(null);
	const [panelMinRect, setPanelMinRect] = useState<DOMRect | null>(null);
	// Measured from the refs the parent (VisualizationPage) hands in — the
	// popup and the slice-jump overlay both live outside this component, so
	// their DOM nodes are only reachable via these external refs.
	const [popupRectMeasured, setPopupRectMeasured] = useState<DOMRect | null>(null);
	const [popupDragRectMeasured, setPopupDragRectMeasured] = useState<DOMRect | null>(null);
	const [popupMinRectMeasured, setPopupMinRectMeasured] = useState<DOMRect | null>(null);
	const [sliceJumpRect, setSliceJumpRect] = useState<DOMRect | null>(null);

	const fieldRef = useRef<HTMLDivElement>(null);
	const maskingFieldRef = useRef<HTMLDivElement>(null);
	const panelBodyRef = useRef<HTMLDivElement>(null);
	const panelHeadRef = useRef<HTMLDivElement>(null);
	const panelMinRef = useRef<HTMLButtonElement>(null);
	const dockElRef = useRef<HTMLDivElement>(null);
	const dockDragRef = useRef<HTMLDivElement>(null);

	// Close the tool walkthrough if the person switches tools (or closes the
	// panel) while it's up — its targets no longer exist under a new tool.
	useEffect(() => {
		setToolWalkthroughOpen(false);
	}, [activeTool]);
	const showTooltip = useCallback((id: string) => {
		const el = iconRefs.current[id];
		setHoveredRect(el ? el.getBoundingClientRect() : null);
		setHoveredTool(id);
	}, []);
	const hideTooltip = useCallback((id: string) => {
		setHoveredTool((cur) => (cur === id ? null : cur));
		setHoveredRect((cur) => (hoveredTool === id ? null : cur));
	}, [hoveredTool]);

	const panel = useDraggablePanel({
		initial: { x: 24, y: 24 },
		expandedSize: { width: 300, height: 420 },
		minimizedSize: { width: 300, height: 46 },
		marginX: -30,
	});
	const dockPanel = useDraggablePanel({
		// Flush against the real right edge on first load. Use clientWidth (not
		// innerWidth) since innerWidth includes the scrollbar's own width, which
		// otherwise leaves a visible gap between the dock and the page content.
		// y is intentionally small so the dock sits near the top of the viewport
		// by default, clear of the segments popup that anchors near the bottom.
		initial: { x: typeof document !== "undefined" ? document.documentElement.clientWidth - ANNOTATION_DOCK_WIDTH : 24, y: 80 },
		// TOOL_DEFS.length icons + minimize button, each ~56px tall (52px + 4px gap), plus padding
		expandedSize: { width: ANNOTATION_DOCK_WIDTH, height: TOOL_DEFS.length * 56 + 60 },
		minimizedSize: { width: ANNOTATION_DOCK_WIDTH, height: 116 }, // 1 icon + minimize button + padding
		marginX: 0,
		// Only left/right dragging is meaningful for a vertical dock; keep it
		// pinned flush to whichever screen edge it's dragged toward, and never
		// let vertical dragging place it where its full icon list would be
		// clipped off the top or bottom of the viewport.
		lockToScreenEdges: true,
	});

	// Recompute every spotlight target whenever either walkthrough is open.
	// Runs on every render while open (cheap: a handful of
	// getBoundingClientRect calls) so it stays correct across panel drags,
	// minimize/expand, and window resizes — none of which have one single
	// event to hook reliably given both panels are freely draggable.
	const anyWalkthroughOpen = toolWalkthroughOpen || overviewWalkthroughOpen;
	useLayoutEffect(() => {
		if (!anyWalkthroughOpen) return;
		const measure = () => {
			setFieldRect(fieldRef.current ? fieldRef.current.getBoundingClientRect() : null);
			setMaskingRect(maskingFieldRef.current ? maskingFieldRef.current.getBoundingClientRect() : null);
			setPanelRect(panelBodyRef.current ? panelBodyRef.current.getBoundingClientRect() : null);
			setPanelDragRect(panelHeadRef.current ? panelHeadRef.current.getBoundingClientRect() : null);
			setDockRect(dockElRef.current ? dockElRef.current.getBoundingClientRect() : null);
			setDockDragRect(dockDragRef.current ? dockDragRef.current.getBoundingClientRect() : null);
			// The dock's minimize button doesn't have its own dedicated ref —
			// it's already tracked in iconRefs (keyed "__min") for the tooltip
			// system, so reuse that instead of threading through a second ref.
			const dockMinEl = iconRefs.current["__min"];
			setDockMinRect(dockMinEl ? dockMinEl.getBoundingClientRect() : null);
			setPanelMinRect(panelMinRef.current ? panelMinRef.current.getBoundingClientRect() : null);
			setPopupRectMeasured(popupRef?.current ? popupRef.current.getBoundingClientRect() : null);
			setPopupDragRectMeasured(popupDragRef?.current ? popupDragRef.current.getBoundingClientRect() : null);
			setPopupMinRectMeasured(popupMinRef?.current ? popupMinRef.current.getBoundingClientRect() : null);
			setSliceJumpRect(sliceJumpRef?.current ? sliceJumpRef.current.getBoundingClientRect() : null);
		};
		measure();
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		const id = window.setInterval(measure, 200); // catches drag moves without their own event hook
		return () => {
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
			window.clearInterval(id);
		};
	}, [anyWalkthroughOpen, panel.pos.x, panel.pos.y, panel.minimized, dockPanel.pos.x, dockPanel.pos.y, dockMinimized, activeTool, popupRef, popupDragRef, popupMinRef, sliceJumpRef]);

	// First-run auto-open: the moment this toolbar is opened (Annotate
	// pressed) with no target picked yet, show the overview tour once per
	// browser. Reopening the dock later (or already having a target) never
	// re-triggers it — the header's "Show walkthrough" launcher is the only
	// way to bring it back after that.
	useEffect(() => {
		if (!open) return;
		if (hasActiveTarget) return;
		let alreadySeen = false;
		try {
			alreadySeen = typeof window !== "undefined" && window.localStorage.getItem(OVERVIEW_WALKTHROUGH_SEEN_KEY) === "1";
		} catch { /* localStorage unavailable — just show it */ }
		if (!alreadySeen) setOverviewWalkthroughOpen(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const dismissOverviewWalkthrough = useCallback(() => {
		setOverviewWalkthroughOpen(false);
		try {
			if (typeof window !== "undefined") window.localStorage.setItem(OVERVIEW_WALKTHROUGH_SEEN_KEY, "1");
		} catch { /* localStorage unavailable — not worth blocking on */ }
	}, []);

	const enabled = hasSegments && hasActiveTarget;

	const selectTool = (tool: Exclude<PrimaryEditTool, null>) => {
		if (!enabled) return;
		onToolChange(activeTool === tool ? null : tool);
	};

	if (!open) return null;

	const activeDef = activeTool ? TOOL_DEFS.find((t) => t.id === activeTool) : null;
	const showRenderingDot = !!isRendering && !!activeTool && LIVE_COMMIT_TOOLS.includes(activeTool);

	// Minimized dock shows exactly one icon: the active tool if one is
	// selected, otherwise Brush (first entry) as the default resting state.
	const minimizedDef = activeDef ?? TOOL_DEFS[0];

	return (
		<>
		<div
			ref={dockElRef}
			className={`atb atb--vertical ${!enabled ? "atb--disabled" : ""} ${dockMinimized ? "atb--vertical-min" : ""}`}
			role="toolbar"
			aria-orientation="vertical"
			style={{ position: "fixed", top: dockPanel.pos.y, left: dockPanel.pos.x, right: "auto", bottom: "auto" }}
		>
			<div
				ref={dockDragRef}
				{...dockPanel.dragHandleProps}
				title="Drag to move"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: "100%",
					height: 16,
					cursor: "grab",
					color: "rgba(255,255,255,0.35)",
					touchAction: "none",
				}}
			>
				<IconGripVertical size={13} />
			</div>
			<div style={{ display: "flex", justifyContent: "center", padding: "0 0 2px" }}>
				<WalkthroughLauncherButton
					label="See demo"
					title="Show the annotation tools walkthrough"
					onClick={() => setOverviewWalkthroughOpen(true)}
				/>
			</div>
				{dockMinimized ? (
					<div
						ref={(el) => { iconRefs.current[minimizedDef.id] = el; }}
						style={{ position: "relative" }}
						onMouseEnter={() => showTooltip(minimizedDef.id)}
						onMouseLeave={() => hideTooltip(minimizedDef.id)}
					>
						<button
							className={`atb__btn ${activeTool === minimizedDef.id ? "is-active" : ""}`}
							onClick={() => selectTool(minimizedDef.id)}
							disabled={!enabled}
							aria-label={minimizedDef.label}
							onFocus={() => showTooltip(minimizedDef.id)}
							onBlur={() => hideTooltip(minimizedDef.id)}
						>
							<minimizedDef.Icon size={26} stroke={1.75} />
						</button>
						{hoveredTool === minimizedDef.id && (
							<IconTooltip
								label={minimizedDef.label}
								description={
									!hasSegments
										? `${minimizedDef.description} (no volume loaded)`
										: !hasActiveTarget
											? `${minimizedDef.description} (pick an organ or create a segment first)`
											: minimizedDef.description
								}
								anchorRect={hoveredRect}
							/>
						)}
					</div>
				) : (
					TOOL_DEFS.map(({ id, label, Icon, description }) => (
						<div
							key={id}
							ref={(el) => { iconRefs.current[id] = el; }}
							style={{ position: "relative" }}
							onMouseEnter={() => showTooltip(id)}
							onMouseLeave={() => hideTooltip(id)}
						>
							<button
								className={`atb__btn ${activeTool === id ? "is-active" : ""}`}
								onClick={() => selectTool(id)}
								disabled={!enabled}
								aria-label={label}
								onFocus={() => showTooltip(id)}
								onBlur={() => hideTooltip(id)}
							>
								<Icon size={50} stroke={1.75} />
							</button>
							{hoveredTool === id && (
								<IconTooltip
									label={label}
									description={
										!hasSegments
											? `${description} (no volume loaded)`
											: !hasActiveTarget
												? `${description} (pick an organ or create a segment first)`
												: description
									}
									anchorRect={hoveredRect}
								/>
							)}
						</div>
					))
				)}

				{/* Minimize toggle — always its own row, never scrolls off with the
				    icon list, so it's reachable regardless of dock state. */}
				<button
					className="atb__btn atb__min-btn"
					onClick={() => setDockMinimized((v) => !v)}
					aria-label={dockMinimized ? "Expand toolbar" : "Minimize toolbar"}
					title={dockMinimized ? "Expand toolbar" : "Minimize toolbar"}
					onMouseEnter={() => showTooltip("__min")}
					onMouseLeave={() => hideTooltip("__min")}
					onFocus={() => showTooltip("__min")}
					onBlur={() => hideTooltip("__min")}
					ref={(el) => { iconRefs.current["__min"] = el; }}
					style={{ position: "relative" }}
				>
					{dockMinimized ? <IconChevronsUp size={18} /> : <IconMinus size={18} />}
				</button>
				{hoveredTool === "__min" && (
					<IconTooltip
						label={dockMinimized ? "Expand toolbar" : "Minimize toolbar"}
						description={dockMinimized ? "Show all tools" : "Collapse to just the active tool"}
						anchorRect={hoveredRect}
					/>
				)}
			</div>

			{activeTool && enabled && activeDef &&
				createPortal(
					<div
						ref={panelBodyRef}
						className={`atb-corner-panel ${panel.minimized ? "is-minimized" : ""}`}
						style={{ position: "fixed", top: panel.pos.y, left: panel.pos.x, right: "auto", bottom: "auto" }}
					>
						<div
							ref={panelHeadRef}
							className="atb-corner-panel__head"
							{...panel.dragHandleProps}
							title="Drag to move"
							style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", cursor: "grab", touchAction: "none" }}
						>
						<span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
							<IconGripVertical size={14} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
							<span style={{ fontSize: 12, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{activeDef.label}
							</span>
							{showRenderingDot && <RenderingIndicator />}
						</span>
							<span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
								{/* Identical launcher in every tool's panel — this is the one
								    and only "Show walkthrough" affordance for whichever tool
								    is currently active, and doubles as the replay control. */}
								<WalkthroughLauncherButton
									label="See demo"
									title={`Show the ${activeDef.label} walkthrough`}
									onClick={(e) => { e.stopPropagation(); setToolWalkthroughOpen(true); }}
								/>
								<button
									ref={panelMinRef}
									className="atb-corner-panel__icon-btn"
									onClick={(e) => { e.stopPropagation(); panel.setMinimized((v) => !v); }}
									aria-label={panel.minimized ? "Expand panel" : "Minimize panel"}
									title={panel.minimized ? "Expand panel" : "Minimize panel"}
								>
									{panel.minimized ? <IconChevronsUp size={16} /> : <IconMinus size={16} />}
								</button>
							</span>
						</div>
						{!panel.minimized && (
							<div className="atb-corner-panel__body">
								<div ref={fieldRef}>
									{(activeTool === "paint" || activeTool === "erase") && (
										<DiameterFlyout
											title={activeDef.label}
											diameterMm={diameterMm}
											onDiameterChange={onDiameterChange}
											onPreviewChange={onDiameterPreviewChange}
										/>
									)}
									{activeTool === "scissors" && (
										<ScissorsFlyout
											options={scissorsOptions}
											onChange={onScissorsOptionsChange}
											pointCount={scissorsPointCount}
											onCancel={onScissorsCancel}
										/>
									)}
									{!["paint", "erase", "scissors"].includes(activeTool) && renderFlyout(activeTool)}
								</div>

								<div ref={maskingFieldRef}>
									<MaskingSelect
										value={maskingArea}
										onChange={onMaskingAreaChange}
										hasActiveSegment={hasActiveTarget}
										hasAnySegments={hasAnySegments}
										locked={!!scopeLocked}
									/>
								</div>
							</div>
						)}
					</div>,
					document.body
				)}

			{activeTool && (
				<ToolWalkthrough
					visible={toolWalkthroughOpen}
					label={`${activeDef?.label ?? "Tool"} walkthrough`}
					onDismiss={() => setToolWalkthroughOpen(false)}
					steps={buildToolSteps(activeTool, {
						panelRect,
						fieldRect,
						maskingRect,
						sliceJumpRect,
					})}
				/>
			)}

			<ToolWalkthrough
				visible={overviewWalkthroughOpen}
				label="Annotation tools walkthrough"
				onDismiss={dismissOverviewWalkthrough}
				steps={buildOverviewSteps({
					...overviewExtraRects,
					popupRect: popupRectMeasured ?? overviewExtraRects?.popupRect,
					popupDragRect: popupDragRectMeasured ?? overviewExtraRects?.popupDragRect,
					popupMinRect: popupMinRectMeasured ?? overviewExtraRects?.popupMinRect,
					dockRect,
					dockDragRect,
					dockMinRect,
					panelRect,
					panelDragRect,
					panelMinRect,
				})}
			/>
		</>
	);
}
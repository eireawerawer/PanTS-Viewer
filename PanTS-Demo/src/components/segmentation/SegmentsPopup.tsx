import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	IconEye, IconEyeOff, IconTrash, IconPlus, IconStack2, IconSparkles,
	IconPencil,
	IconLoader2, IconTargetArrow,
} from "@tabler/icons-react";
import type { CheckBoxData } from "../../types";
import "./SegmentsPopup.css";
import ApplyButton from "../ApplyButton";
import { GuidedStepModal } from "../segmentation/SliceAnchorPickerUI";

interface SegmentsPopupProps {
	/** Mirrors AnnotationToolbar's own `open` prop: the component stays
	 *  mounted (and its drag/resize state alive) at all times — closing just
	 *  renders null after the hooks have run — so a dragged position isn't
	 *  lost every time the panel is toggled off and back on. */
	open: boolean;
	segments: CheckBoxData[];
	colors: Record<number, string>;
	visibility: Record<number, boolean>;
	activeSegmentId: number | null;
	onSelect: (id: number | null) => void;
	onRename: (id: number, name: string) => boolean;
	onColorChange: (id: number, hex: string) => void;
	onToggleVisibility: (id: number) => void;
	onDelete: (id: number) => void;
	onCreate: (name: string, colorHex: string) => CheckBoxData | null;
	organCatalog: { id: number; label: string }[];
	activeCatalogOrganId: number | null;
	onSelectCatalogOrgan: (id: number | null) => void;

	/** Fires whenever the "any deletes currently in flight" state flips, so
	 *  the parent can surface it in AnnotationToolbar's own "Deleting…"
	 *  indicator (this popup lives outside that component). True from the
	 *  moment a delete is confirmed until the deleted class has actually
	 *  left `segments`. */
	onDeletingChange?: (isDeleting: boolean) => void;

	/** Refs the parent (VisualizationPage) attaches this component's outer
	 *  panel and header to, so AnnotationToolbar's Overview walkthrough can
	 *  spotlight this popup even though it lives outside that component. */
	containerRef?: React.RefObject<HTMLDivElement | null>;
	dragHandleRef?: React.RefObject<HTMLDivElement | null>;
	/** Kept for callers still passing it through (e.g. the walkthrough
	 *  spotlight rects) — there's no minimize button anymore, so nothing
	 *  attaches a ref to it, but removing the prop would be a breaking
	 *  change to every call site for no behavioral benefit. */
	minButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

// Normalizes any organ label to Title Case ("Adrenal Gland Left") so the
// Existing-class list reads consistently regardless of how the source
// label was originally cased.
function toTitleCase(label: string): string {
	return label
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

// Suggested default swatch for the next new class — cycles through the
// Hopkins palette so a freshly-created class starts on-brand. Can still be
// repainted via the color input afterward.
const NEXT_COLOR_POOL = ["#002D72", "#68ACE5", "#0A2540", "#002D72", "#68ACE5", "#0A2540"];

// Applies to both the "add segment" and "rename" name fields.
const MAX_SEGMENT_NAME_LENGTH = 40;

// Kept in sync with the CSS transition durations in SegmentsPopup.css so
// JS timers gate the real state change at the right moment.
const EXIT_ANIM_MS = 200;

type PopupTab = "existing" | "custom";

// Small curated swatch set for the color popover — Hopkins palette first,
// then a handful of common accent colors so classes stay visually distinct.
const SWATCH_PRESETS = [
	"#002D72", "#68ACE5", "#0A2540", "#E85D5D", "#4CAF7D",
	"#F2B33D", "#9B6BD6", "#2FB6C4", "#D9645B", "#7C8A9E",
];

interface ColorPickerPopoverProps {
	value: string;
	onChange: (hex: string) => void;
	onClose: () => void;
	/** Swatch button this popover is anchored to — used only to compute a
	 *  fixed viewport position, since the popover itself portals to
	 *  <body> (see below) rather than rendering inline. */
	anchorRef: React.RefObject<HTMLElement | null>;
}

// Small anchored popover for picking a class color — a grid of preset
// swatches plus a native color input for anything custom. Gradually
// scales/fades in on open and back out on close (mirrors GuidedStepModal's
// treatment elsewhere in the annotation tool) instead of the browser's own
// abrupt native color picker being the only way in.
//
// Portals to <body> and positions itself with `fixed` coords computed from
// the swatch button's own rect, rather than rendering inline where
// .segpop__list/.segpop__row's overflow:hidden (needed for their own
// scroll/collapse animations) would otherwise clip it to the panel. This
// lets the popover spill out over the canvas instead of being boxed in.
function ColorPickerPopover({ value, onChange, onClose, anchorRef }: ColorPickerPopoverProps) {
	const [closing, setClosing] = useState(false);
	const popRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

	const requestClose = () => {
		if (closing) return;
		setClosing(true);
		window.setTimeout(onClose, EXIT_ANIM_MS);
	};

	useEffect(() => {
		const compute = () => {
			const anchor = anchorRef.current;
			if (!anchor) return;
			const rect = anchor.getBoundingClientRect();
			const popW = popRef.current?.offsetWidth ?? 208;
			const popH = popRef.current?.offsetHeight ?? 0;
			const margin = 8;
			// Prefer opening to the right of the swatch; flip to the left if
			// it would run off the viewport edge, and clamp vertically so it
			// never gets pushed off the top/bottom either.
			let left = rect.right + margin;
			if (left + popW > window.innerWidth - margin) {
				left = rect.left - popW - margin;
			}
			left = Math.max(margin, Math.min(left, window.innerWidth - popW - margin));
			let top = rect.top;
			if (popH) top = Math.max(margin, Math.min(top, window.innerHeight - popH - margin));
			setPos({ top, left });
		};
		compute();
		window.addEventListener("resize", compute);
		window.addEventListener("scroll", compute, true);
		return () => {
			window.removeEventListener("resize", compute);
			window.removeEventListener("scroll", compute, true);
		};
	}, [anchorRef]);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (popRef.current?.contains(e.target as Node)) return;
			if (anchorRef.current?.contains(e.target as Node)) return;
			requestClose();
		};
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") requestClose(); };
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (typeof document === "undefined" || !pos) return null;

	return createPortal(
		<div
			ref={popRef}
			className={`segpop__color-popover segpop__color-popover--portaled ${closing ? "is-closing" : "is-open"}`}
			style={{ position: "fixed", top: pos.top, left: pos.left }}
			onClick={(e) => e.stopPropagation()}
		>
			<div className="segpop__color-popover-grid">
				{SWATCH_PRESETS.map((hex) => (
					<button
						key={hex}
						type="button"
						className={`segpop__color-popover-swatch ${value.toLowerCase() === hex.toLowerCase() ? "is-active" : ""}`}
						style={{ background: hex }}
						aria-label={hex}
						onClick={() => onChange(hex)}
					/>
				))}
			</div>
			<label className="segpop__color-popover-custom">
				<input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
				<span>Custom…</span>
			</label>
		</div>,
		document.body
	);
}

// Alternative to the old grid-template-rows(0fr/1fr) collapse trick, which
// read as "stuck halfway then vanishes" — that approach animates a CSS grid
// track, but the *content itself* wasn't clipped to match at every instant
// (an error line appearing/disappearing changes the natural height out from
// under the grid animation, and the two could visibly desync), and the
// close was driven by a JS setTimeout guessing the transition's real
// duration rather than the transition itself, so a slow frame or a
// mid-flight re-render could unmount the row before (or well after) it had
// actually finished animating.
//
// This instead measures the *real* pixel height of the content (via the
// inner ref's scrollHeight) and animates `max-height` directly to that
// number, then releases it to `none` once open so dynamic content (an
// error message showing up, the character-count line, etc.) can still grow
// freely without being clipped. Closing reverses that: pin the current
// height to a concrete px first (you can't transition away from `none`),
// then flip to 0 on the next frame. Either direction's completion is driven
// by the transition's own `onTransitionEnd`, not a timer, so there's no
// duration to keep in sync with the CSS and no way for it to fire early or
// late.
interface CollapseProps {
	/** true = expanded/open, false = animate closed. The caller keeps this
	 *  component mounted for a beat after flipping to false (see
	 *  `onExited`) so the close transition is visible instead of the row
	 *  just disappearing. */
	in: boolean;
	/** Fires once the close transition has genuinely finished — the right
	 *  moment for the caller to actually unmount this row/form. */
	onExited?: () => void;
	children: React.ReactNode;
	className?: string;
}

function Collapse({ in: open, onExited, children, className = "" }: CollapseProps) {
	const innerRef = useRef<HTMLDivElement>(null);
	const [maxHeight, setMaxHeight] = useState<number | "none">(open ? "none" : 0);
	const rafRef = useRef<number | null>(null);
	const mountedRef = useRef(false);

	useEffect(() => {
		const el = innerRef.current;
		if (!el) return;

		// First paint: just reflect the initial state, nothing to animate
		// yet (avoids an unwanted transition from 0 the instant a row that
		// starts out open first mounts).
		if (!mountedRef.current) {
			mountedRef.current = true;
			return;
		}

		if (open) {
			// Opening: animate from wherever we are (0, most commonly) up to
			// the content's real measured height.
			setMaxHeight(el.scrollHeight);
		} else {
			// Closing: if we're currently sitting at `none` (fully open,
			// content free to grow), pin that down to today's actual pixel
			// height first — `none` can't be transitioned away from
			// directly — then let the next frame drop it to 0 so the
			// browser has a real numeric start point to animate from.
			setMaxHeight(el.scrollHeight);
			rafRef.current = requestAnimationFrame(() => setMaxHeight(0));
		}
		return () => {
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const handleTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
		if (e.target !== e.currentTarget || e.propertyName !== "max-height") return;
		if (open) {
			// Release the cap so content that changes height while open
			// (error text, char-count line) isn't clipped or fighting a
			// stale measured number.
			setMaxHeight("none");
		} else {
			onExited?.();
		}
	};

	return (
		<div
			className={`segpop__collapse ${open ? "is-open" : "is-closing"} ${className}`}
			style={{ maxHeight: maxHeight === "none" ? "none" : `${maxHeight}px` }}
			onTransitionEnd={handleTransitionEnd}
		>
			<div ref={innerRef} className="segpop__collapse-inner">
				{children}
			</div>
		</div>
	);
}

// Single compact "this is the current target" indicator, shared by both the
// custom-class rows and the existing-organ rows so the two tabs read the
// same way. Icon-only (with a tooltip) so it costs as little row width as
// possible, leaving more room for the name itself.
function TargetBadge() {
	return (
		<span className="segpop__target-badge" title="Currently targeted" aria-label="Currently targeted">
			<IconTargetArrow size={13} />
		</span>
	);
}

// Gap kept clear between the docked panel's top edge and the reserved
// annotation area above it (topbar + ribbon + flyout strip — see
// --vp-topbar-h / --atb-ribbon-h / --atb-panel-h in AnnotationToolbar.css).
// --atb-panel-h is measured live off the flyout's content (see the
// ResizeObserver in AnnotationToolbar.tsx) and is 0px when no tool is
// selected, so the panel docks directly under the ribbon until a tool's
// options row opens. The flat "+10px" is breathing room, kept in sync
// with the matching margin-top on .vp-stage in VisualizationPage.css.
const DOCK_CLEARANCE = "calc(var(--vp-topbar-h, 0px) + var(--atb-ribbon-h, 42px) + var(--atb-panel-h, 0px) + 15px)";
const POPUP_WIDTH = 320;
const POPUP_MIN_WIDTH = 240;
const POPUP_MAX_WIDTH = 560;
const RIGHT_MARGIN = 0; // flush to the viewport edge, same as AISidebar

/**
 * Segments panel — docked to the top-right, directly beneath the ribbon +
 * flyout strip, like a permanent slide-in side panel (same pattern as the
 * AI sidebar) rather than a freely draggable window that can end up
 * sitting on top of the CT viewer, and sized to its content instead of
 * spanning the full viewport height. Only its width is still adjustable
 * (drag the left edge) so it can be made more or less roomy for long
 * segment names; it never moves off its docked corner. Minimizable to a
 * small horizontal bar.
 */
export default function SegmentsPopup({
	open, segments, colors, visibility, activeSegmentId,
	onSelect, onRename, onColorChange, onToggleVisibility, onDelete, onCreate, onDeletingChange,
	organCatalog, activeCatalogOrganId, onSelectCatalogOrgan,
	containerRef, dragHandleRef,
}: SegmentsPopupProps) {
	// Horizontal resize — drag the left edge to widen/narrow the docked
	// panel. The handle sits on the LEFT edge (the popup is anchored to the
	// right side of the viewport) so growing it extends leftward, away from
	// the dock, while the right edge stays flush against the viewport.
	const [width, setWidth] = useState(POPUP_WIDTH);
	const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

	useEffect(() => {
		const onMove = (e: PointerEvent) => {
			const st = resizeStateRef.current;
			if (!st) return;
			const delta = st.startX - e.clientX; // dragging left = positive delta = wider
			const next = Math.min(POPUP_MAX_WIDTH, Math.max(POPUP_MIN_WIDTH, st.startWidth + delta));
			setWidth(next);
		};
		const onUp = () => { resizeStateRef.current = null; };
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
	}, []);

	const startResize = (e: React.PointerEvent) => {
		e.preventDefault();
		e.stopPropagation();
		resizeStateRef.current = { startX: e.clientX, startWidth: width };
	};

	// Keep --atb-segpanel-w in sync with the panel's real width (0 when
	// closed) so VisualizationPage.css's `padding-right: var(--atb-segpanel-w)`
	// reserves the actual space instead of a hardcoded fallback, letting
	// the CT viewer shrink to make room as this panel is resized.
	useEffect(() => {
		const root = document.documentElement;
		root.style.setProperty("--atb-segpanel-w", open ? `${width}px` : "0px");
	}, [open, width]);

const [tab, setTab] = useState<PopupTab>("existing");

  // `adding` drives the Collapse's `in` prop (expanded vs. animating
  // closed); `addFormMounted` stays true for the extra beat it takes the
  // close transition to actually finish, cleared only by Collapse's own
  // `onExited` — so the form is never yanked out mid-animation.
	const [adding, setAdding] = useState(false);
	const [addFormMounted, setAddFormMounted] = useState(false);
	const [draftName, setDraftName] = useState("");
	const [draftColor, setDraftColor] = useState(NEXT_COLOR_POOL[segments.length % NEXT_COLOR_POOL.length]);
	const [createError, setCreateError] = useState("");
	const [addColorPopoverOpen, setAddColorPopoverOpen] = useState(false);

	// Combined name+color editor, opened via the pen icon (replaces the old
	// double-click-to-rename-only flow — both fields are changed and
	// confirmed together, in one place).
	// `editingId` drives Collapse's `in` prop; `editRowMountedId` stays set
	// (same pattern as addFormMounted above) until Collapse's `onExited`
	// confirms the close transition has actually finished.
	const [editingId, setEditingId] = useState<number | null>(null);
	const [editRowMountedId, setEditRowMountedId] = useState<number | null>(null);
	const [editNameDraft, setEditNameDraft] = useState("");
	const [editColorDraft, setEditColorDraft] = useState("#ffffff");
	const [renameError, setRenameError] = useState<number | null>(null);
	const [editColorPopoverOpen, setEditColorPopoverOpen] = useState(false);
	// Anchors for the portaled ColorPickerPopover — one swatch button lives
	// in the add-form, the other in the inline edit row, and only one of
	// either is ever mounted at a time, but keeping separate refs avoids
	// them fighting over a single ref across renders.
	const addColorBtnRef = useRef<HTMLButtonElement>(null);
	const editColorBtnRef = useRef<HTMLButtonElement>(null);

	// Deletion can take a moment on the backend — track in-flight deletes
	// locally so the row can show a spinner instead of looking unresponsive,
	// and so it can fade/collapse out smoothly before it actually leaves the
	// list rather than disappearing the instant the click lands.
	const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
	useEffect(() => {
		setDeletingIds((prev) => {
			if (prev.size === 0) return prev;
			const stillPresent = new Set(segments.map((s) => s.id));
			const next = new Set([...prev].filter((id) => stillPresent.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [segments]);

	// Tell the parent (VisualizationPage → AnnotationToolbar) whenever the
	// "something is deleting" state actually flips, not on every render —
	// onDeletingChange isn't guaranteed to be referentially stable, so this
	// only fires on a real true/false transition.
	const wasDeletingRef = useRef(false);
	useEffect(() => {
		const isDeleting = deletingIds.size > 0;
		if (isDeleting !== wasDeletingRef.current) {
			wasDeletingRef.current = isDeleting;
			onDeletingChange?.(isDeleting);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [deletingIds]);

	// Class awaiting delete confirmation — the trash icon no longer deletes
	// on the first click; it opens this confirm overlay (same GuidedStepModal
	// treatment as the guided-flow tools) and only Delete-in-the-overlay
	// actually triggers handleDelete's fade-out + real removal.
	const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

	const handleDelete = (id: number) => {
		setDeletingIds((prev) => new Set(prev).add(id));
		// Let the row play its fade/collapse-out transition before the
		// underlying delete actually lands and yanks it out of the list.
		window.setTimeout(() => onDelete(id), EXIT_ANIM_MS);
	};

	const switchTab = (next: PopupTab) => {
		setTab(next);
		setAdding(false);
		setAddFormMounted(false);
		setCreateError("");
		setEditingId(null);
		setEditRowMountedId(null);
		setConfirmDeleteId(null);
	};

	const startAdd = () => {
		setAdding(true);
		setAddFormMounted(true);
		setDraftName("");
		setCreateError("");
		setDraftColor(NEXT_COLOR_POOL[segments.length % NEXT_COLOR_POOL.length]);
	};

	// Kicks off the add-form's collapse-out transition — shared by both
	// Cancel and a successful Add so closing always reads the same way
	// regardless of why it's closing. The form stays mounted (see
	// `addFormMounted`) until Collapse's `onExited` fires below, once the
	// animation has genuinely finished.
	const closeAddForm = () => {
		setAddColorPopoverOpen(false);
		setAdding(false);
	};

	const commitAdd = (): boolean => {
		const trimmed = draftName.trim();
		if (!trimmed) { setCreateError("Enter a name."); return false; }
		const lower = trimmed.toLowerCase();
		const dupCustom = segments.some((s) => s.label.toLowerCase() === lower);
		const dupCatalog = organCatalog.some((o) => o.label.toLowerCase() === lower);
		if (dupCustom || dupCatalog) {
			setCreateError(
				dupCatalog
					? "That name matches an existing class — pick it from the Existing tab instead."
					: "That name is already used."
			);
			return false;
		}
		const created = onCreate(trimmed, draftColor);
		if (!created) { setCreateError("Could not create class."); return false; }
		setDraftName("");
		setCreateError("");
		// Closing the form (its own fade/collapse-out) is deferred to
		// ApplyButton's onDone, which fires once the "Added" checkmark has
		// had a beat on screen — so the confirmation is actually seen
		// before the form collapses, instead of both happening at once.
		return true;
	};

	const startEdit = (id: number, currentName: string, currentColor: string) => {
		setEditingId(id);
		setEditRowMountedId(id);
		setEditNameDraft(currentName);
		setEditColorDraft(currentColor);
		setRenameError(null);
	};
	// Kicks off the edit row's collapse-out transition, shared by Save and
	// Cancel so both close the same way. The row stays mounted until
	// Collapse's `onExited` fires (see the render below), once the close
	// transition has actually finished — no more setTimeout guessing.
	const closeEdit = (id: number) => {
		setEditColorPopoverOpen(false);
		setEditingId((cur) => (cur === id ? null : cur));
	};
	const cancelEdit = () => {
		if (editingId == null) return;
		setRenameError(null);
		closeEdit(editingId);
	};
	const commitEdit = (id: number): boolean => {
		const trimmed = editNameDraft.trim();
		if (!trimmed) { cancelEdit(); return false; }
		const lower = trimmed.toLowerCase();
		const dupCustom = segments.some((s) => s.id !== id && s.label.toLowerCase() === lower);
		const dupCatalog = organCatalog.some((o) => o.label.toLowerCase() === lower);
		if (dupCustom || dupCatalog) { setRenameError(id); return false; }
		const renamed = onRename(id, trimmed);
		if (!renamed) { setRenameError(id); return false; }
		onColorChange(id, editColorDraft);
		setRenameError(null);
		// Closing the edit row is deferred to ApplyButton's onDone (see
		// commitAdd above) so the "Saved" checkmark is visible for a beat
		// before the row collapses back to its normal state.
		return true;
	};

	const handleSelectExisting = (id: number) => {
		onSelectCatalogOrgan(id === activeCatalogOrganId ? null : id);
	};

	const isCustomActive = (id: number) => activeSegmentId === id && activeCatalogOrganId == null;


	const addClassRef = useRef<HTMLDivElement>(null);
	const tableRef = useRef<HTMLDivElement>(null);
	const tabsRef = useRef<HTMLDivElement>(null);
	const catalogListRef = useRef<HTMLDivElement>(null);




	// Bailing out here (rather than gating mount/unmount from the parent)
	// keeps drag position, resize width, editing state, etc. alive across
	// the popup being shown and hidden.
	if (typeof document === "undefined") return null;

	// Portal to <body>, like AISidebar, since the page root has
	// overflow:hidden and would otherwise clip this fixed-position panel.
	// Slides in/out via transform rather than resizing/collapsing — `open`
	// is the same boolean that shows/hides the annotation ribbon.
	return createPortal(
			<div
				ref={containerRef}
				className={`segpop segpop--anchor-top segpop--docked ${open ? "is-open" : "is-closed"}`}
				style={{
					position: "fixed",
					left: "auto",
					top: DOCK_CLEARANCE,
					bottom: 0,
					right: RIGHT_MARGIN,
					width,
				}}
			>
				{/* Resize handle: drag left to widen, right to narrow. Absolutely
				    positioned so it doesn't interfere with the column-reverse flex
				    ordering of the header/tabs/body below it. */}
				<div
					className="segpop__resize-handle"
					onPointerDown={startResize}
					title="Drag to resize"
				>
					<span className="segpop__resize-grip" />
				</div>

				{/* DOM order: body, tabs, header — column-reverse renders the last
				    child at the top, so visual order is header, tabs, body. Body
				    is the flexed, internally-scrolling region that fills the dock. */}
				<div className="segpop__body" ref={tableRef}>
						{/* Keyed on `tab` so switching between Existing/Custom plays a
						    quick fade+slide-in instead of the content just snapping to
						    the other tab's rows instantly. */}
						<div key={tab} className="segpop__tab-content">
						{tab === "existing" ? (
							<>
								<div className="segpop__hint">Pick an existing class in this scan to edit it directly.</div>
								{organCatalog.length === 0 ? (
									<div className="segpop__empty">No classes detected in this case.</div>
								) : (
									<div className="segpop__catalog-list" ref={catalogListRef}>
										{organCatalog.map((o) => (
											<button
												key={o.id}
												className={`segpop__catalog-row ${activeCatalogOrganId === o.id ? "is-active" : ""}`}
												onClick={() => handleSelectExisting(o.id)}
											>
												<span className="segpop__catalog-row-name">{toTitleCase(o.label)}</span>
												{activeCatalogOrganId === o.id && <TargetBadge />}
											</button>
										))}
									</div>
								)}
							</>
						) : (
							<>
								{segments.length === 0 && !adding && (
									<div className="segpop__empty">No custom classes yet.</div>
								)}

								{segments.map((s) => {
									const active = isCustomActive(s.id);
									const hex = colors[s.id] ?? "#ffffff";
									const isEditing = editingId === s.id;
									const isEditRowMounted = editRowMountedId === s.id;

									if (isEditRowMounted) {
										const remaining = MAX_SEGMENT_NAME_LENGTH - editNameDraft.length;
										return (
											<Collapse
												key={s.id}
												in={isEditing}
												onExited={() => setEditRowMountedId((cur) => (cur === s.id ? null : cur))}
												className="segpop__row segpop__row--editing"
											>
												<div
													className="segpop__row--editing-inner"
													onClick={(e) => e.stopPropagation()}
												>
												{/* Swatch button opens the gradual color popover instead of the
												    OS's own abrupt native picker — same swatch look as the static
												    row, just clickable while editing. */}
												<div className="segpop__color-anchor">
													<button
														ref={editColorBtnRef}
														type="button"
														className="segpop__color segpop__color-btn"
														style={{ background: editColorDraft }}
														aria-label="Class color"
														title="Change color"
														onClick={() => setEditColorPopoverOpen((v) => !v)}
													/>
													{editColorPopoverOpen && isEditing && (
														<ColorPickerPopover
															value={editColorDraft}
															onChange={setEditColorDraft}
															onClose={() => setEditColorPopoverOpen(false)}
															anchorRef={editColorBtnRef}
														/>
													)}
												</div>
												<input
													autoFocus
													className={`segpop__name-input ${renameError === s.id ? "is-error" : ""}`}
													value={editNameDraft}
													maxLength={MAX_SEGMENT_NAME_LENGTH}
													onChange={(e) => { setEditNameDraft(e.target.value); setRenameError(null); }}
													onKeyDown={(e) => {
														// Same fix as the add-form input above: close on a
														// successful Enter-commit instead of leaving the row
														// stuck open in edit mode.
														if (e.key === "Enter") { if (commitEdit(s.id)) closeEdit(s.id); }
														if (e.key === "Escape") cancelEdit();
													}}
												/>
												{renameError === s.id && <span className="segpop__err segpop__err--block">Name in use</span>}
												{renameError !== s.id && remaining <= 10 && (
													<span className="segpop__err segpop__err--block segpop__char-count">{remaining} characters left</span>
												)}
												{/* Same Apply/Cancel row arrangement as the "Add class"
												    form below — one standardized commit control across the
												    popup instead of this row's own bespoke Save/X buttons. */}
												<div className="segpop__row-actions">
													<ApplyButton className="segpop__add-confirm" onApply={() => commitEdit(s.id)} onDone={() => closeEdit(s.id)} label="Save" applyingLabel="Saving…" successLabel="Saved" />
													<button className="atb-action-btn segpop__add-cancel-text" onClick={cancelEdit}>
														<span className="atb-action-btn__label">Cancel</span>
													</button>
												</div>
												</div>
											</Collapse>
										);
									}

									const isDeleting = deletingIds.has(s.id);
									return (
										<div
											key={s.id}
											className={`segpop__row ${active ? "is-active" : ""} ${isDeleting ? "is-deleting" : ""}`}
											onClick={() => { if (!isDeleting) { onSelect(active ? null : s.id); } }}
										>
											<button
												className="segpop__vis"
												onClick={(e) => { e.stopPropagation(); onToggleVisibility(s.id); }}
												aria-label={visibility[s.id] !== false ? "Hide" : "Show"}
												disabled={isDeleting}
											>
												{visibility[s.id] !== false ? <IconEye size={15} /> : <IconEyeOff size={15} />}
											</button>
											<span className="segpop__swatch" style={{ background: hex }} aria-hidden="true" />
											<span className="segpop__name" title={s.label}>
												{s.label}
											</span>
											{active && !isDeleting && <TargetBadge />}
											{!isDeleting && (
												<button
													className="segpop__edit-btn"
													onClick={(e) => { e.stopPropagation(); startEdit(s.id, s.label, hex); }}
													aria-label="Rename / recolor"
													title="Rename / recolor"
												>
													<IconPencil size={13} />
												</button>
											)}
											<button
												className="segpop__delete"
												onClick={(e) => { e.stopPropagation(); if (!isDeleting) setConfirmDeleteId(s.id); }}
												aria-label={isDeleting ? "Deleting…" : "Delete"}
												title={isDeleting ? "Deleting…" : "Delete class"}
												disabled={isDeleting}
											>
												{isDeleting ? <IconLoader2 size={13} className="segpop__spin" /> : <IconTrash size={13} />}
											</button>
										</div>
									);
								})}

								{confirmDeleteId != null && (
									<GuidedStepModal
										title="Delete this class?"
										instruction={`"${segments.find((s) => s.id === confirmDeleteId)?.label ?? "This class"}" and its segmentation will be permanently removed. This can't be undone.`}
										primaryLabel="Delete"
										onPrimary={() => {
											const id = confirmDeleteId;
											setConfirmDeleteId(null);
											handleDelete(id);
										}}
										secondaryLabel="Cancel"
										onSecondary={() => setConfirmDeleteId(null)}
									/>
								)}

								{addFormMounted ? (
									<Collapse
										in={adding}
										onExited={() => setAddFormMounted(false)}
										className="segpop__add-form"
									>
										<div className="segpop__add-form-inner" ref={addClassRef}>
										<div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
											<div className="segpop__color-anchor">
												<button
													ref={addColorBtnRef}
													type="button"
													className="segpop__color segpop__color-btn"
													style={{ background: draftColor }}
													aria-label="Class color"
													title="Change color"
													onClick={() => setAddColorPopoverOpen((v) => !v)}
												/>
												{addColorPopoverOpen && (
													<ColorPickerPopover
														value={draftColor}
														onChange={setDraftColor}
														onClose={() => setAddColorPopoverOpen(false)}
														anchorRef={addColorBtnRef}
													/>
												)}
											</div>
											<input
												autoFocus
												className={`segpop__name-input ${createError ? "is-error" : ""}`}
												placeholder="Class name"
												value={draftName}
												maxLength={MAX_SEGMENT_NAME_LENGTH}
												onChange={(e) => { setDraftName(e.target.value); setCreateError(""); }}
												onKeyDown={(e) => {
													// Mirrors the ApplyButton path below: on a successful add,
													// close the form the same way clicking "Add class" would
													// (previously this just called commitAdd() and left the
													// form sitting open with no visible next step).
													if (e.key === "Enter") { if (commitAdd()) closeAddForm(); }
													if (e.key === "Escape") closeAddForm();
												}}
											/>
										</div>
										{createError && <span className="segpop__err segpop__err--block">{createError}</span>}
										<div className="segpop__row-actions">
											{/* Same ApplyButton used by every flyout's "do this now"
											    action — one consistent commit control across the panel. */}
											<ApplyButton className="segpop__add-confirm" onApply={commitAdd} onDone={closeAddForm} label="Add class" applyingLabel="Adding…" successLabel="Added" />
											<button className="atb-action-btn segpop__add-cancel-text" onClick={closeAddForm}>
												<span className="atb-action-btn__label">Cancel</span>
											</button>
										</div>
										</div>
									</Collapse>
								) : (
									<div ref={addClassRef}>
										<button className="segpop__new" onClick={startAdd}>
											<IconPlus size={15} /> Add class
										</button>
									</div>
								)}
							</>
						)}
						</div>
					</div>

					<div ref={tabsRef} className="segpop__tabs" onClick={(e) => e.stopPropagation()}>
						<button className={`segpop__tab ${tab === "existing" ? "is-active" : ""}`} onClick={() => switchTab("existing")}>
							<IconStack2 size={14} />
							Existing class
							{activeCatalogOrganId != null && <span className="segpop__tab-dot" />}
						</button>
						<button className={`segpop__tab ${tab === "custom" ? "is-active" : ""}`} onClick={() => switchTab("custom")}>
							<IconSparkles size={14} />
							Custom
							{activeSegmentId != null && activeCatalogOrganId == null && <span className="segpop__tab-dot" />}
						</button>
					</div>

					{/* Drag handle only now — the title text used to repeat
					    "Existing class"/"Custom classes" right below tab
					    buttons that already say the same thing, so it was
					    dropped. dragHandleRef still needs a DOM node to
					    attach to for the popup's drag behavior. */}
					<div ref={dragHandleRef} className="segpop__head" />


		</div>,
		document.body
	);
}
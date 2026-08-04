import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	IconEye, IconEyeOff, IconTrash, IconPlus, IconX, IconStack2, IconSparkles,
	IconMinus, IconChevronsUp, IconGripVertical, IconPencil,
	IconLoader2, IconTargetArrow, IconDeviceFloppy,
} from "@tabler/icons-react";
import type { CheckBoxData } from "../../types";
import "./SegmentsPopup.css";
import { useDraggablePanel } from "../../helpers/viewer/useDraggablePanel";
import { ANNOTATION_DOCK_WIDTH } from "../viewer/AnnotationToolbar";
import ToolWalkthrough, { WalkthroughLauncherButton } from "../walkthrough/ToolWalkthrough";
import { buildCustomClassSteps, buildExistingOrganSteps } from "../walkthrough/WalkthroughContent";

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
	onSelect: (id: number) => void;
	onRename: (id: number, name: string) => boolean;
	onColorChange: (id: number, hex: string) => void;
	onToggleVisibility: (id: number) => void;
	onDelete: (id: number) => void;
	onCreate: (name: string, colorHex: string) => CheckBoxData | null;
	organCatalog: { id: number; label: string }[];
	activeCatalogOrganId: number | null;
	onSelectCatalogOrgan: (id: number | null) => void;

	/** Refs the parent (VisualizationPage) attaches this component's outer
	 *  panel and drag-header to, so AnnotationToolbar's Overview walkthrough
	 *  can spotlight this popup even though it lives outside that component.
	 *  Both are safe to pass through even while minimized — only one of the
	 *  two header elements is ever mounted at a time, and this same ref
	 *  object is attached to whichever one is currently rendered. Same idea
	 *  for minButtonRef: it's attached to whichever minimize/expand button is
	 *  currently rendered (expanded header's "Minimize" or the minimized
	 *  bar's "Expand"), so the Overview walkthrough can spotlight it too. */
	containerRef?: React.RefObject<HTMLDivElement>;
	dragHandleRef?: React.RefObject<HTMLDivElement>;
	minButtonRef?: React.RefObject<HTMLButtonElement>;
}

const NEXT_COLOR_POOL = ["#f43f5e", "#eab308", "#22c55e", "#6ea8fe", "#a855f7", "#22d3ee", "#f97316", "#ec4899"];

// Applies to both the "add segment" and "rename" name fields.
const MAX_SEGMENT_NAME_LENGTH = 40;

type PopupTab = "existing" | "custom";

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

// Gap kept clear between the popup's right edge and the dock's left edge so
// they never touch even at the default position — see ANNOTATION_DOCK_WIDTH.
// DOCK_GAP is the breathing room against the dock itself; EXTRA_LEFT_OFFSET
// pushes the default position further left still, since the dock's icon
// tooltips/flyouts open leftward and would otherwise overlap the popup.
const DOCK_GAP = 16;
const EXTRA_LEFT_OFFSET = 48;
const DOCK_CLEARANCE = ANNOTATION_DOCK_WIDTH + DOCK_GAP + EXTRA_LEFT_OFFSET;
const POPUP_WIDTH = 320;
const POPUP_MIN_WIDTH = 240;
const POPUP_MAX_WIDTH = 560;

/**
 * Segments popup — draggable, anchored at its bottom edge so it always grows
 * upward (dragging it near the bottom of the screen never hides it). Renders
 * expanded by default, positioned just left of the vertical tool dock.
 * Minimizable to a small centered horizontal bar.
 */
export default function SegmentsPopup({
	open, segments, colors, visibility, activeSegmentId,
	onSelect, onRename, onColorChange, onToggleVisibility, onDelete, onCreate,
	organCatalog, activeCatalogOrganId, onSelectCatalogOrgan,
	containerRef, dragHandleRef, minButtonRef,
}: SegmentsPopupProps) {
	const panel = useDraggablePanel({
		initial: {
			// Same viewport metric (clientWidth, not innerWidth) the dock itself
			// uses for its flush-right default — mixing the two here previously
			// meant the two "flush to the right edge" numbers could disagree by
			// however wide the scrollbar happened to be.
			x: typeof document !== "undefined" ? document.documentElement.clientWidth - DOCK_CLEARANCE - POPUP_WIDTH : 24,
			y: typeof window !== "undefined" ? window.innerHeight - 20 : 24,
		},
		expandedSize: { width: POPUP_WIDTH, height: 360 },
		minimizedSize: { width: POPUP_WIDTH, height: 46 },
		anchorBottom: true,
	});
	const minimized = panel.minimized;
	const setMinimized = panel.setMinimized;

	// Horizontal resize, independent of useDraggablePanel's own drag-to-move
	// handling. The handle sits on the LEFT edge (the popup is anchored near
	// the right-hand tool dock) so growing it extends leftward, away from the
	// dock, while the right edge — panel.pos.x + width — stays put.
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

	const [tab, setTab] = useState<PopupTab>(activeCatalogOrganId != null ? "existing" : "custom");

	const [adding, setAdding] = useState(false);
	const [draftName, setDraftName] = useState("");
	const [draftColor, setDraftColor] = useState(NEXT_COLOR_POOL[segments.length % NEXT_COLOR_POOL.length]);
	const [createError, setCreateError] = useState("");

	// Combined name+color editor, opened via the pen icon (replaces the old
	// double-click-to-rename-only flow — both fields are changed and
	// confirmed together, in one place).
	const [editingId, setEditingId] = useState<number | null>(null);
	const [editNameDraft, setEditNameDraft] = useState("");
	const [editColorDraft, setEditColorDraft] = useState("#ffffff");
	const [renameError, setRenameError] = useState<number | null>(null);

	// Deletion can take a moment on the backend — track in-flight deletes
	// locally so the row can show a spinner instead of looking unresponsive.
	// Cleared automatically once the segment actually disappears from props.
	const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
	useEffect(() => {
		setDeletingIds((prev) => {
			if (prev.size === 0) return prev;
			const stillPresent = new Set(segments.map((s) => s.id));
			const next = new Set([...prev].filter((id) => stillPresent.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [segments]);

	const handleDelete = (id: number) => {
		setDeletingIds((prev) => new Set(prev).add(id));
		onDelete(id);
	};

	const switchTab = (next: PopupTab) => {
		setTab(next);
		setAdding(false);
		setCreateError("");
		setEditingId(null);
	};

	const startAdd = () => {
		setAdding(true);
		setDraftName("");
		setCreateError("");
		setDraftColor(NEXT_COLOR_POOL[segments.length % NEXT_COLOR_POOL.length]);
	};

	const commitAdd = () => {
		const trimmed = draftName.trim();
		if (!trimmed) { setCreateError("Enter a name."); return; }
		const lower = trimmed.toLowerCase();
		const dupCustom = segments.some((s) => s.label.toLowerCase() === lower);
		const dupCatalog = organCatalog.some((o) => o.label.toLowerCase() === lower);
		if (dupCustom || dupCatalog) {
			setCreateError(
				dupCatalog
					? "That name matches an existing organ — pick it from the Existing tab instead."
					: "That name is already used."
			);
			return;
		}
		const created = onCreate(trimmed, draftColor);
		if (!created) { setCreateError("Could not create segment."); return; }
		setAdding(false);
		setDraftName("");
		setCreateError("");
	};

	const startEdit = (id: number, currentName: string, currentColor: string) => {
		setEditingId(id);
		setEditNameDraft(currentName);
		setEditColorDraft(currentColor);
		setRenameError(null);
	};
	const cancelEdit = () => {
		setEditingId(null);
		setRenameError(null);
	};
	const commitEdit = (id: number) => {
		const trimmed = editNameDraft.trim();
		if (!trimmed) { cancelEdit(); return; }
		const lower = trimmed.toLowerCase();
		const dupCustom = segments.some((s) => s.id !== id && s.label.toLowerCase() === lower);
		const dupCatalog = organCatalog.some((o) => o.label.toLowerCase() === lower);
		if (dupCustom || dupCatalog) { setRenameError(id); return; }
		const renamed = onRename(id, trimmed);
		if (!renamed) { setRenameError(id); return; }
		onColorChange(id, editColorDraft);
		setEditingId(null);
		setRenameError(null);
	};

	const handleSelectExisting = (id: number) => {
		onSelectCatalogOrgan(id === activeCatalogOrganId ? null : id);
	};

	const isCustomActive = (id: number) => activeSegmentId === id && activeCatalogOrganId == null;

	// --- Walkthroughs ---------------------------------------------------------
	// Two replayable walkthroughs live in this popup, one per tab — Custom
	// class (creating/managing a custom class) and Existing organ (picking an
	// already-segmented catalog organ). Each has its own launcher button in
	// the header (identical WalkthroughLauncherButton used everywhere else)
	// and is built from the matching buildXSteps content. Both share the same
	// measure-on-interval effect below since they can point at overlapping UI
	// (the tab bar, the body list) and only one is ever open at a time.
	const [customWalkthroughOpen, setCustomWalkthroughOpen] = useState(false);
	const [existingWalkthroughOpen, setExistingWalkthroughOpen] = useState(false);
	const addClassRef = useRef<HTMLDivElement>(null);
	const tableRef = useRef<HTMLDivElement>(null);
	const tabsRef = useRef<HTMLDivElement>(null);
	const catalogListRef = useRef<HTMLDivElement>(null);
	const [addClassRect, setAddClassRect] = useState<DOMRect | null>(null);
	const [tableRect, setTableRect] = useState<DOMRect | null>(null);
	const [tabsRect, setTabsRect] = useState<DOMRect | null>(null);
	const [catalogListRect, setCatalogListRect] = useState<DOMRect | null>(null);

	const anyWalkthroughOpen = customWalkthroughOpen || existingWalkthroughOpen;

	useLayoutEffect(() => {
		if (!anyWalkthroughOpen) return;
		const measure = () => {
			setAddClassRect(addClassRef.current ? addClassRef.current.getBoundingClientRect() : null);
			setTableRect(tableRef.current ? tableRef.current.getBoundingClientRect() : null);
			setTabsRect(tabsRef.current ? tabsRef.current.getBoundingClientRect() : null);
			setCatalogListRect(catalogListRef.current ? catalogListRef.current.getBoundingClientRect() : (tableRef.current ? tableRef.current.getBoundingClientRect() : null));
		};
		measure();
		window.addEventListener("resize", measure);
		const id = window.setInterval(measure, 200);
		return () => {
			window.removeEventListener("resize", measure);
			window.clearInterval(id);
		};
	}, [anyWalkthroughOpen, panel.pos.x, panel.pos.y, minimized, tab]);

	// All hooks above have run unconditionally on every render — bailing out
	// here (rather than gating the component's mount/unmount from the parent)
	// is what keeps drag position, resize width, editing state, etc. alive
	// across the popup being shown and hidden.
	if (!open) return null;

	return (
		<div
			ref={containerRef}
			className={`segpop segpop--anchor-bottom ${minimized ? "segpop--min" : ""}`}
			style={{
				position: "fixed",
				left: panel.pos.x - (width - POPUP_WIDTH),
				top: "auto",
				bottom: `calc(100vh - ${panel.pos.y}px)`,
				right: "auto",
				width: minimized ? undefined : width,
			}}
		>
			{minimized ? (
				// Minimized: single row, everything centered — no column-reverse
				// ordering games needed since there's only one row.
				<div ref={dragHandleRef} className="segpop__head segpop__head--min" {...panel.dragHandleProps} title="Drag to move" style={{ cursor: "grab", touchAction: "none" }}>
					<span className="segpop__title">
						<IconGripVertical size={14} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
						{tab === "existing" ? "Existing organ" : `Custom classes${segments.length > 0 ? ` (${segments.length})` : ""}`}
					</span>
					<button
						ref={minButtonRef}
						className="segpop__min-btn"
						onClick={(e) => { e.stopPropagation(); setMinimized((v) => !v); }}
						aria-label="Expand"
						title="Expand"
					>
						<IconChevronsUp size={16} />
					</button>
				</div>
			) : (
				<>
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

					{/* DOM order: body, tabs, header — column-reverse renders the LAST
					    child at the TOP, so visual order top-to-bottom is header, tabs, body.
					    The wrapper's `bottom` style is what stays fixed while dragging;
					    everything above grows upward from it. */}
					<div className="segpop__body" ref={tableRef}>
						{tab === "existing" ? (
							<>
								<div className="segpop__hint">Pick an organ already segmented in this scan to edit it directly.</div>
								{organCatalog.length === 0 ? (
									<div className="segpop__empty">No organs detected in this case.</div>
								) : (
									<div className="segpop__catalog-list" ref={catalogListRef}>
										{organCatalog.map((o) => (
											<button
												key={o.id}
												className={`segpop__catalog-row ${activeCatalogOrganId === o.id ? "is-active" : ""}`}
												onClick={() => handleSelectExisting(o.id)}
											>
												<span className="segpop__catalog-row-name">{o.label}</span>
												{activeCatalogOrganId === o.id && <TargetBadge />}
											</button>
										))}
									</div>
								)}
							</>
						) : (
							<>
								{segments.length === 0 && !adding && (
									<div className="segpop__empty">No custom segments yet — add one below.</div>
								)}

								{segments.map((s) => {
									const active = isCustomActive(s.id);
									const hex = colors[s.id] ?? "#ffffff";
									const isEditing = editingId === s.id;

									if (isEditing) {
										const remaining = MAX_SEGMENT_NAME_LENGTH - editNameDraft.length;
										return (
											<div key={s.id} className="segpop__row segpop__row--editing" onClick={(e) => e.stopPropagation()}>
												{/* Single swatch: the native color input IS the swatch — clicking it
												    opens the OS color picker and updates this same square, so there's
												    only ever one color chip visible while editing. */}
												<input
													type="color"
													className="segpop__color"
													value={editColorDraft}
													onChange={(e) => setEditColorDraft(e.target.value)}
													aria-label="Segment color"
													title="Click to change color"
												/>
												<input
													autoFocus
													className={`segpop__name-input ${renameError === s.id ? "is-error" : ""}`}
													value={editNameDraft}
													maxLength={MAX_SEGMENT_NAME_LENGTH}
													onChange={(e) => { setEditNameDraft(e.target.value); setRenameError(null); }}
													onKeyDown={(e) => {
														if (e.key === "Enter") commitEdit(s.id);
														if (e.key === "Escape") cancelEdit();
													}}
												/>
												<button className="segpop__edit-confirm" onClick={() => commitEdit(s.id)} aria-label="Save changes" title="Save changes">
													<IconDeviceFloppy size={14} />
													Save
												</button>
												<button className="segpop__edit-cancel" onClick={cancelEdit} aria-label="Cancel" title="Cancel">
													<IconX size={14} />
												</button>
												{renameError === s.id && <span className="segpop__err segpop__err--block">Name in use</span>}
												{renameError !== s.id && remaining <= 10 && (
													<span className="segpop__err segpop__err--block segpop__char-count">{remaining} characters left</span>
												)}
											</div>
										);
									}

									const isDeleting = deletingIds.has(s.id);
									return (
										<div
											key={s.id}
											className={`segpop__row ${active ? "is-active" : ""} ${isDeleting ? "is-deleting" : ""}`}
											onClick={() => { if (!isDeleting) { onSelect(s.id); onSelectCatalogOrgan(null); } }}
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
												onClick={(e) => { e.stopPropagation(); if (!isDeleting) handleDelete(s.id); }}
												aria-label={isDeleting ? "Deleting…" : "Delete"}
												title={isDeleting ? "Deleting…" : "Delete segment"}
												disabled={isDeleting}
											>
												{isDeleting ? <IconLoader2 size={13} className="segpop__spin" /> : <IconTrash size={13} />}
											</button>
										</div>
									);
								})}

								{adding ? (
									<div className="segpop__add-form" ref={addClassRef}>
										<input type="color" className="segpop__color" value={draftColor} onChange={(e) => setDraftColor(e.target.value)} />
										<input
											autoFocus
											className={`segpop__name-input ${createError ? "is-error" : ""}`}
											placeholder="Segment name"
											value={draftName}
											maxLength={MAX_SEGMENT_NAME_LENGTH}
											onChange={(e) => { setDraftName(e.target.value); setCreateError(""); }}
											onKeyDown={(e) => {
												if (e.key === "Enter") commitAdd();
												if (e.key === "Escape") setAdding(false);
											}}
										/>
										<button className="segpop__add-confirm" onClick={commitAdd}>Add</button>
										<button className="segpop__add-cancel" onClick={() => setAdding(false)} aria-label="Cancel">
											<IconX size={14} />
										</button>
										{createError && <span className="segpop__err segpop__err--block">{createError}</span>}
									</div>
								) : (
									<div ref={addClassRef}>
										<button className="segpop__new" onClick={startAdd}>
											<IconPlus size={15} /> Add segment
										</button>
									</div>
								)}
							</>
						)}
					</div>

					<div ref={tabsRef} className="segpop__tabs" onClick={(e) => e.stopPropagation()}>
						<button className={`segpop__tab ${tab === "existing" ? "is-active" : ""}`} onClick={() => switchTab("existing")}>
							<IconStack2 size={14} />
							Existing organ
							{activeCatalogOrganId != null && <span className="segpop__tab-dot" />}
						</button>
						<button className={`segpop__tab ${tab === "custom" ? "is-active" : ""}`} onClick={() => switchTab("custom")}>
							<IconSparkles size={14} />
							Custom
							{activeSegmentId != null && activeCatalogOrganId == null && <span className="segpop__tab-dot" />}
						</button>
					</div>

					<div ref={dragHandleRef} className="segpop__head" {...panel.dragHandleProps} title="Drag to move" style={{ cursor: "grab", touchAction: "none" }}>
						<span className="segpop__title">
							<IconGripVertical size={14} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
							{tab === "existing" ? "Existing organ" : `Custom classes${segments.length > 0 ? ` (${segments.length})` : ""}`}
						</span>
						<span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
							{tab === "custom" && (
								<WalkthroughLauncherButton
									label="See demo"
									title="Show the custom class walkthrough"
									onClick={(e) => { e.stopPropagation(); setCustomWalkthroughOpen(true); }}
								/>
							)}
							{tab === "existing" && (
								<WalkthroughLauncherButton
									label="See demo"
									title="Show the existing organ walkthrough"
									onClick={(e) => { e.stopPropagation(); setExistingWalkthroughOpen(true); }}
								/>
							)}
							<button
								ref={minButtonRef}
								className="segpop__min-btn"
								onClick={(e) => { e.stopPropagation(); setMinimized((v) => !v); }}
								aria-label="Minimize"
								title="Minimize"
							>
								<IconMinus size={16} />
							</button>
						</span>
					</div>
				</>
			)}

			<ToolWalkthrough
				visible={customWalkthroughOpen}
				label="Custom class walkthrough"
				onDismiss={() => setCustomWalkthroughOpen(false)}
				steps={buildCustomClassSteps({ addClassRect, tableRect })}
			/>

			<ToolWalkthrough
				visible={existingWalkthroughOpen}
				label="Existing organ walkthrough"
				onDismiss={() => setExistingWalkthroughOpen(false)}
				steps={buildExistingOrganSteps({ listRect: catalogListRect, tabsRect })}
			/>
		</div>
	);
}
import { useEffect, useState } from "react";
import JSZip from "jszip";
import {
	IconArrowBackUp,
	IconArrowForwardUp,
	IconBrush,
	IconCloudUpload,
	IconDownload,
	IconEraser,
	IconLasso,
	IconPlus,
	IconWand,
} from "@tabler/icons-react";
import {
	colorForNewClass,
	copySegmentAcrossSlices,
	dilateActiveSegment,
	erodeActiveSegment,
	getCustomSegmentLabelsForExport,
	getMaskEditHistoryState,
	getSegmentationExport,
	getVolumeSliceIndexForPane,
	interpolateSegmentBetweenSlices,
	redoMaskEdit,
	setActiveEditSegment,
	setMaskBrushSize,
	setPaneSliceIndex,
	subscribeToSegmentationEdits,
	undoMaskEdit,
	type CinePane,
} from "../../helpers/CornerstoneNifti2";
import { buildNiftiGzBlob } from "../../helpers/niftiWriter";
import { downloadBlob } from "../../helpers/readingSession";
import type { CheckBoxData } from "../../types";
import "./MaskEditPanel.css";

export type MaskEditMode = "brush" | "eraser" | "smartfill" | "lasso" | null;

// ---------------------------------------------------------------------------
// Props — grouped by the section of the panel they feed, in the same order
// the sections appear below.
// ---------------------------------------------------------------------------

interface MaskEditPanelProps {
	// Identity ------------------------------------------------------------
	organs: CheckBoxData[];
	caseId: string;
	/** Dataset case id — shown on the (currently disabled) "save to server" button. */
	serverCaseId?: string;

	// Panel lifecycle -------------------------------------------------------
	mode: MaskEditMode;
	onModeChange: (mode: MaskEditMode) => void;
	onClose: () => void;
	/** Reading-session hook — fires once per edit burst with a description. */
	onEdit?: (detail: string) => void;
	/** Create a new label class (name + hex colour) and return it for the organ list. */
	onCreateClass?: (name: string, colorHex: string) => CheckBoxData | null;

	// Smart Fill (dual-scribble) --------------------------------------------
	smartFillMarkMode: "fg" | "bg";
	onSmartFillMarkModeChange: (m: "fg" | "bg") => void;
	smartFillScope: "slice" | "volume";
	onSmartFillScopeChange: (s: "slice" | "volume") => void;
	onApplySmartFill: () => void;
	onClearSmartFillScribbles: () => void;

	// Lasso (plain polygon — no magnetic snapping) ---------------------------
	lassoAnchorCount: number;
	onLassoUndo: () => void;
	onLassoClose: () => void;
	onLassoCancel: () => void;

	// Morphology (erode / dilate only) ---------------------------------------
	morphScope: "segment" | "island";
	onMorphScopeChange: (s: "segment" | "island") => void;
	pickingMorphTarget: boolean;
	onPickIsland: () => void;
	morphSeedVoxel: [number, number, number] | null;

	// Slice tools (interpolation / copy) — need to know which pane is
	// focused (as a sensible default) and how many slices it has.
	focusedPane: CinePane;
	totalSlices: number;
}

const PANES: { value: CinePane; label: string }[] = [
	{ value: "axial", label: "Axial" },
	{ value: "sagittal", label: "Sagittal" },
	{ value: "coronal", label: "Coronal" },
];

function colorToHex([r, g, b]: readonly number[]): string {
	const h = (n: number) => n.toString(16).padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Right-side panel for correcting segmentation masks. Everything happens
 * client-side on the loaded labelmap volume; nothing here touches the server
 * until "Download" is pressed ("Save to server" is temporarily disabled —
 * see Section 7).
 *
 * Sections, top to bottom:
 *   1. Target organ + new-class creation
 *   2. Undo / redo (shared by every mode below)
 *   3. Mode toolbar: Paint / Erase / Smart Fill / Lasso
 *   4. Mode-specific controls
 *   5. Morphology (erode / dilate) — applies to the active segment
 *   6. Slice tools: shape interpolation, copy-across-slices
 *   7. Export: download .nii.gz (save-to-server disabled for now)
 */
function MaskEditPanel({
	organs,
	caseId,
	serverCaseId,
	mode,
	onModeChange,
	onClose,
	onEdit,
	onCreateClass,
	smartFillMarkMode,
	onSmartFillMarkModeChange,
	smartFillScope,
	onSmartFillScopeChange,
	onApplySmartFill,
	onClearSmartFillScribbles,
	lassoAnchorCount,
	onLassoUndo,
	onLassoClose,
	onLassoCancel,
	morphScope,
	onMorphScopeChange,
	pickingMorphTarget,
	onPickIsland,
	morphSeedVoxel,
	focusedPane,
	totalSlices,
}: MaskEditPanelProps) {
	// ---- Section 1: target organ + new class ---------------------------------
	const [segment, setSegment] = useState(organs[0]?.id ?? 1);
	const [showNewClass, setShowNewClass] = useState(false);
	const [newClassName, setNewClassName] = useState("");
	const [newClassColor, setNewClassColor] = useState(() =>
		colorToHex(colorForNewClass((organs.length || 0) + 1))
	);
	const [createError, setCreateError] = useState("");

	// Brush size lives here (not lifted) — only this panel's Paint/Erase UI
	// and the Cornerstone brush tool need it.
	const [brushMm, setBrushMm] = useState(10);

	// Seed the brush target/size once, on mount; change handlers keep them current.
	useEffect(() => {
		setActiveEditSegment(segment);
		setMaskBrushSize(brushMm);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// If the selected segment disappears (e.g. organ list refreshed), fall back
	// to the first available one rather than pointing at a dead id.
	useEffect(() => {
		if (organs.some((o) => o.id === segment)) return;
		const fallback = organs[0]?.id ?? 1;
		setSegment(fallback);
		setActiveEditSegment(fallback);
	}, [organs, segment]);

	const selectSegment = (id: number) => {
		setSegment(id);
		setActiveEditSegment(id);
	};

	const createClass = () => {
		setCreateError("");
		const trimmed = newClassName.trim();
		if (!trimmed) {
			setCreateError("Enter a name for the new class.");
			return;
		}
		if (!onCreateClass) return;
		const created = onCreateClass(trimmed, newClassColor);
		if (!created) {
			setCreateError("Could not create class — is a segmentation loaded?");
			return;
		}
		selectSegment(created.id);
		setNewClassName("");
		setNewClassColor(colorToHex(colorForNewClass(created.id + 1)));
		setShowNewClass(false);
		onModeChange("brush");
		onEdit?.(`Created new class "${created.label}"`);
	};

	// ---- Section 2: undo/redo history ----------------------------------------
	const [edited, setEdited] = useState(false);
	const [history, setHistory] = useState({ canUndo: false, canRedo: false });

	useEffect(() => {
		const organLabel = organs.find((o) => o.id === segment)?.label ?? `segment ${segment}`;
		const unsubscribe = subscribeToSegmentationEdits(() => {
			setEdited(true);
			setHistory(getMaskEditHistoryState());
			onEdit?.(`Edited ${organLabel} mask`);
		});
		return unsubscribe;
	}, [segment, organs, onEdit]);

	const undo = () => {
		undoMaskEdit();
		setHistory(getMaskEditHistoryState());
	};
	const redo = () => {
		redoMaskEdit();
		setHistory(getMaskEditHistoryState());
	};

	// ---- Section 6: slice tools (interpolation + copy-across-slices) --------
	const [interpPane, setInterpPane] = useState<CinePane>(focusedPane);
	const [interpFirstSlice, setInterpFirstSlice] = useState("");
	const [interpLastSlice, setInterpLastSlice] = useState("");
	const [copyPane, setCopyPane] = useState<CinePane>(focusedPane);
	const [copyFirstSlice, setCopyFirstSlice] = useState("");
	const [copyLastSlice, setCopyLastSlice] = useState("");

	// Resolves a pane + typed 1-based slice number to the volume's real slice
	// index, by actually navigating there.
	const resolveSliceIndex = (pane: CinePane, typedSlice: number): number | null => {
		setPaneSliceIndex(pane, typedSlice - 1);
		return getVolumeSliceIndexForPane(pane);
	};

	const runInterpolation = () => {
		const first = Number(interpFirstSlice);
		const last = Number(interpLastSlice);
		if (!Number.isFinite(first) || !Number.isFinite(last) || first === last) return;

		const a = resolveSliceIndex(interpPane, first);
		const b = resolveSliceIndex(interpPane, last);
		if (a === null || b === null) {
			onEdit?.("Interpolation failed — could not resolve slice position.");
			return;
		}

		const result = interpolateSegmentBetweenSlices(interpPane, a, b, segment);
		if (result?.changedVoxels) {
			onEdit?.(`Interpolated ${result.slicesWritten} slices (${result.changedVoxels.toLocaleString()} vox)`);
			setPaneSliceIndex(interpPane, last - 1);
		} else {
			onEdit?.(
				"Interpolation did nothing — draw the segment fully on both slices and confirm the right organ is selected."
			);
		}
	};

	const runCopyAcrossSlices = () => {
		const first = Number(copyFirstSlice);
		const last = Number(copyLastSlice);
		if (!Number.isFinite(first) || !Number.isFinite(last)) return;
		if (first === last) {
			onEdit?.("Pick two different slices.");
			return;
		}

		const from = resolveSliceIndex(copyPane, first);
		const to = resolveSliceIndex(copyPane, last);
		if (from === null || to === null) {
			onEdit?.("Copy failed — could not resolve slice position.");
			return;
		}

		const result = copySegmentAcrossSlices(copyPane, from, to, segment);
		if (result?.changedVoxels) {
			onEdit?.(
				`Copied slice ${first} across ${result.slicesWritten} slices (${result.changedVoxels.toLocaleString()} vox)`
			);
			setPaneSliceIndex(copyPane, last - 1);
		} else {
			onEdit?.("Copy failed — draw the segment fully on the first slice before copying.");
		}
	};

	// ---- Section 7: export ----------------------------------------------------
	const [exporting, setExporting] = useState(false);

	const download = () => {
		const labelmap = getSegmentationExport();
		if (!labelmap) return;

		setExporting(true);
		// Gzipping a full labelmap blocks for a moment; rAF lets the button
		// repaint to its busy state first.
		requestAnimationFrame(() => {
			void (async () => {
				try {
					const customLabels = getCustomSegmentLabelsForExport();
					const hasCustomClasses = Object.keys(customLabels).length > 0;

					if (!hasCustomClasses) {
						downloadBlob(buildNiftiGzBlob(labelmap), `case${caseId}_edited_labels.nii.gz`);
					} else {
						// Custom classes exist — bundle mask + labels.json so the
						// name/colour metadata survives the round trip.
						const zip = new JSZip();
						zip.file("combined_labels_edited.nii.gz", buildNiftiGzBlob(labelmap));
						zip.file("labels.json", JSON.stringify(customLabels, null, 2));
						const blob = await zip.generateAsync({ type: "blob" });
						downloadBlob(blob, `case${caseId}_edited_labels.zip`);
					}
				} finally {
					setExporting(false);
				}
			})();
		});
	};

	// ---- Render ----------------------------------------------------------------
	return (
		<div
			className="vp-edit"
			role="region"
			aria-label="Edit masks"
			style={{ display: "flex", flexDirection: "column", maxHeight: "100vh", overflow: "hidden" }}
		>
			<div className="vp-edit__head">
				<span className="vp-panel__title">Edit Masks</span>
				<button className="vp-edit__close" onClick={onClose} aria-label="Close mask editing">
					×
				</button>
			</div>

			<div className="vp-edit__body" style={{ overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
				{/* ---- 1. Target organ + new class ---- */}
				<label className="vp-edit__field">
					<span className="vp-edit__label">Target organ</span>
					<select
						className="vp-edit__select"
						value={segment}
						onChange={(e) => selectSegment(Number(e.target.value))}
					>
						{organs.map((o) => (
							<option key={o.id} value={o.id}>
								{o.label}
							</option>
						))}
					</select>
				</label>

				{onCreateClass && (
					<div className="vp-edit__new-class">
						<button
							type="button"
							className={`vp-edit__new-toggle ${showNewClass ? "is-open" : ""}`}
							onClick={() => setShowNewClass((v) => !v)}
						>
							<IconPlus size={15} />
							{showNewClass ? "Cancel new class" : "New class…"}
						</button>
						{showNewClass && (
							<div className="vp-edit__new-form">
								<label className="vp-edit__field">
									<span className="vp-edit__label">Class name</span>
									<input
										type="text"
										className="vp-edit__input"
										placeholder="e.g. lesion, stent"
										value={newClassName}
										onChange={(e) => setNewClassName(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") createClass();
										}}
									/>
								</label>
								<label className="vp-edit__field">
									<span className="vp-edit__label">Colour</span>
									<div className="vp-edit__color-row">
										<input
											type="color"
											className="vp-edit__color"
											value={newClassColor}
											onChange={(e) => setNewClassColor(e.target.value)}
											aria-label="New class colour"
										/>
										<span className="vp-edit__color-swatch" style={{ background: newClassColor }} />
									</div>
								</label>
								{createError && <div className="vp-edit__error">{createError}</div>}
								<button type="button" className="vp-edit__create" onClick={createClass}>
									<IconBrush size={15} /> Create &amp; paint
								</button>
							</div>
						)}
					</div>
				)}

				{/* ---- 2. Undo / redo — shared across every mode below ---- */}
				<div className="vp-edit__history">
					<button className="vp-edit__btn" disabled={!history.canUndo} onClick={undo}>
						<IconArrowBackUp size={15} /> Undo
					</button>
					<button className="vp-edit__btn" disabled={!history.canRedo} onClick={redo}>
						<IconArrowForwardUp size={15} /> Redo
					</button>
				</div>

				{/* ---- 3. Mode toolbar ---- */}
				<div className="vp-edit__modes">
					<button
						className={`vp-edit__mode ${mode === "brush" ? "is-active" : ""}`}
						onClick={() => onModeChange(mode === "brush" ? null : "brush")}
					>
						<IconBrush size={16} /> Paint
					</button>
					<button
						className={`vp-edit__mode ${mode === "eraser" ? "is-active" : ""}`}
						onClick={() => onModeChange(mode === "eraser" ? null : "eraser")}
					>
						<IconEraser size={16} /> Erase
					</button>
					<button
						className={`vp-edit__mode ${mode === "smartfill" ? "is-active" : ""}`}
						onClick={() => onModeChange(mode === "smartfill" ? null : "smartfill")}
					>
						<IconWand size={16} /> Smart Fill
					</button>
					<button
						className={`vp-edit__mode ${mode === "lasso" ? "is-active" : ""}`}
						onClick={() => onModeChange(mode === "lasso" ? null : "lasso")}
					>
						<IconLasso size={16} /> Lasso
					</button>
				</div>

				{/* ---- 4a. Brush / Eraser controls ---- */}
				{(mode === "brush" || mode === "eraser" || mode === null) && (
					<label className="vp-edit__field">
						<span className="vp-edit__label">
							Brush size <span>{brushMm} mm</span>
						</span>
						<input
							type="range"
							min={2}
							max={40}
							step={1}
							className="vp-range"
							aria-label="Brush size"
							value={brushMm}
							onChange={(e) => {
								const mm = Number(e.target.value);
								setBrushMm(mm);
								setMaskBrushSize(mm);
							}}
						/>
					</label>
				)}

				{/* ---- 4b. Smart Fill controls ---- */}
				{mode === "smartfill" && (
					<div className="vp-edit__smartfill">
						<span className="vp-edit__label">Fill scope</span>
						<div className="vp-edit__method-grid">
							<button
								type="button"
								className={`vp-edit__method-card ${smartFillScope === "slice" ? "is-active" : ""}`}
								onClick={() => onSmartFillScopeChange("slice")}
							>
								<strong>Current Slice</strong>
								<span>Dual-scribble fill on the slice you're marking</span>
							</button>
							<button
								type="button"
								className={`vp-edit__method-card ${smartFillScope === "volume" ? "is-active" : ""}`}
								onClick={() => onSmartFillScopeChange("volume")}
							>
								<strong>All Slices</strong>
								<span>Dual-scribble fill grown through the full volume</span>
							</button>
						</div>

						<div className="vp-edit__modes">
							<button
								className={`vp-edit__mode ${smartFillMarkMode === "fg" ? "is-active" : ""}`}
								onClick={() => onSmartFillMarkModeChange("fg")}
							>
								Mark Inside
							</button>
							<button
								className={`vp-edit__mode ${smartFillMarkMode === "bg" ? "is-active" : ""}`}
								onClick={() => onSmartFillMarkModeChange("bg")}
							>
								Mark Outside
							</button>
						</div>

						<div className="vp-edit__hint">
							Dot inside, switch to "Mark Outside", dot what to exclude, then Fill.
							{smartFillScope === "slice"
								? " Restricted to the slice your scribbles are on."
								: " Grows through the whole volume."}
						</div>

						<div className="vp-edit__history">
							<button className="vp-edit__btn" onClick={onApplySmartFill}>
								Fill
							</button>
							<button className="vp-edit__btn" onClick={onClearSmartFillScribbles}>
								Clear
							</button>
						</div>
					</div>
				)}

				{/* ---- 4c. Lasso controls ---- */}
				{mode === "lasso" && (
					<div className="vp-edit__field">
						<span className="vp-edit__label">
							Lasso ({lassoAnchorCount} pt{lassoAnchorCount === 1 ? "" : "s"})
						</span>
						<div className="vp-edit__hint">
							Click to drop points — straight edges between them. Close the loop
							(or press Close) once you have at least 3 points, to fill it.
						</div>
						<div className="vp-edit__modes">
							<button className="vp-edit__mode" disabled={lassoAnchorCount === 0} onClick={onLassoUndo}>
								Undo Point
							</button>
							<button className="vp-edit__mode" disabled={lassoAnchorCount < 3} onClick={onLassoClose}>
								Close &amp; Fill
							</button>
						</div>
						<button
							className="vp-edit__btn"
							style={{ width: "100%" }}
							disabled={lassoAnchorCount === 0}
							onClick={onLassoCancel}
						>
							Cancel
						</button>
					</div>
				)}

				{/* ---- 5. Morphology — applies to the active segment regardless of mode ---- */}
				<div className="vp-edit__field">
					<span className="vp-edit__label">Morphology target</span>
					<div className="vp-edit__modes">
						<button
							className={`vp-edit__mode ${morphScope === "segment" ? "is-active" : ""}`}
							onClick={() => onMorphScopeChange("segment")}
						>
							Whole segment
						</button>
						<button
							className={`vp-edit__mode ${morphScope === "island" ? "is-active" : ""}`}
							onClick={() => onMorphScopeChange("island")}
						>
							Selected island
						</button>
					</div>
					{morphScope === "island" && (
						<button className="vp-edit__mode" style={{ width: "100%" }} onClick={onPickIsland}>
							{pickingMorphTarget
								? "Click a blob on any pane…"
								: morphSeedVoxel
									? "✓ Island picked — click Erode/Dilate (click to re-pick)"
									: "Pick an island…"}
						</button>
					)}
				</div>

				<div className="vp-edit__field">
					<span className="vp-edit__label">Morphology (active segment)</span>
					<div className="vp-edit__modes">
						<button
							className="vp-edit__mode"
							onClick={() => {
								const seed = morphScope === "island" ? morphSeedVoxel ?? undefined : undefined;
								const r = erodeActiveSegment(1, 6, seed);
								if (r) onEdit?.(`Eroded (${r.changedVoxels.toLocaleString()} vox)`);
							}}
						>
							Erode
						</button>
						<button
							className="vp-edit__mode"
							onClick={() => {
								const seed = morphScope === "island" ? morphSeedVoxel ?? undefined : undefined;
								const r = dilateActiveSegment(1, 6, seed);
								if (r) onEdit?.(`Dilated (${r.changedVoxels.toLocaleString()} vox)`);
							}}
						>
							Dilate
						</button>
					</div>
				</div>

				{/* ---- 6. Slice tools: interpolation + copy-across-slices ---- */}
				<div className="vp-edit__field">
					<span className="vp-edit__label">Shape interpolation (SDT)</span>
					<select
						className="vp-edit__select"
						value={interpPane}
						onChange={(e) => setInterpPane(e.target.value as CinePane)}
					>
						{PANES.map((p) => (
							<option key={p.value} value={p.value}>
								{p.label}
							</option>
						))}
					</select>
					<div className="vp-edit__modes">
						<input
							type="number"
							className="vp-edit__input"
							placeholder="First slice #"
							min={1}
							max={totalSlices}
							value={interpFirstSlice}
							onChange={(e) => setInterpFirstSlice(e.target.value)}
						/>
						<input
							type="number"
							className="vp-edit__input"
							placeholder="Last slice #"
							min={1}
							max={totalSlices}
							value={interpLastSlice}
							onChange={(e) => setInterpLastSlice(e.target.value)}
						/>
					</div>
					<button
						className="vp-edit__btn"
						style={{ width: "100%" }}
						disabled={!interpFirstSlice || !interpLastSlice || interpFirstSlice === interpLastSlice}
						onClick={runInterpolation}
					>
						Interpolate
					</button>
					<div className="vp-edit__hint">
						Draw the segment fully on two slices of the chosen pane, type their slice numbers, then interpolate.
					</div>
				</div>

				<div className="vp-edit__field">
					<span className="vp-edit__label">Copy across slices</span>
					<select
						className="vp-edit__select"
						value={copyPane}
						onChange={(e) => setCopyPane(e.target.value as CinePane)}
					>
						{PANES.map((p) => (
							<option key={p.value} value={p.value}>
								{p.label}
							</option>
						))}
					</select>
					<div className="vp-edit__modes">
						<input
							type="number"
							className="vp-edit__input"
							placeholder="First slice #"
							min={1}
							max={totalSlices}
							value={copyFirstSlice}
							onChange={(e) => setCopyFirstSlice(e.target.value)}
						/>
						<input
							type="number"
							className="vp-edit__input"
							placeholder="Last slice #"
							min={1}
							max={totalSlices}
							value={copyLastSlice}
							onChange={(e) => setCopyLastSlice(e.target.value)}
						/>
					</div>
					<button
						className="vp-edit__btn"
						style={{ width: "100%" }}
						disabled={!copyFirstSlice || !copyLastSlice || copyFirstSlice === copyLastSlice}
						onClick={runCopyAcrossSlices}
					>
						Copy first slice through last
					</button>
					<div className="vp-edit__hint">
						Draw the segment fully on the "first" slice number of the chosen pane, then run.
					</div>
				</div>

				{/* ---- 7. Export ---- */}
				<button className="vp-edit__download" disabled={!edited || exporting} onClick={download}>
					<IconDownload size={16} />
					{exporting ? "Packing…" : "Download edited mask (.nii.gz)"}
				</button>
				{serverCaseId && (
					// Server save is temporarily disabled while the endpoint is
					// reworked. Left wired up (minus the network call) so
					// re-enabling later is a one-line flip, not a rebuild.
					<button className="vp-edit__save" disabled title="Coming soon">
						<IconCloudUpload size={16} />
						Save to server 
					</button>
				)}
				<div className="vp-edit__hint">
					{mode
						? `${
								mode === "brush"
									? "Painting"
									: mode === "eraser"
										? "Erasing"
										: mode === "smartfill"
											? "Smart-filling"
											: "Lassoing"
							} on the 2D panes.`
						: "Pick a mode above, then work on any 2D pane."}
					{" "}Edits stay in your browser until downloaded.
				</div>
			</div>
		</div>
	);
}

export default MaskEditPanel;
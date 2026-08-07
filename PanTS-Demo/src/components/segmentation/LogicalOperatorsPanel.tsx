import type { LogicalOperation } from "../../helpers/CornerstoneNifti2";
import type { CheckBoxData } from "../../types";
import ApplyButton from "../ApplyButton";
import OperationPicker, { type OperationOption } from "../OperationPicker";

interface LogicalOperatorsPanelProps {
	segments: CheckBoxData[];
	targetSegmentId: number;
	onApply: (operation: LogicalOperation, sourceSegmentId: number | null, bypassMasking: boolean) => void;
	// Selections live in the parent so they survive the panel unmounting when
	// the flyout is minimized or switched away from and back.
	operation: LogicalOperation;
	onOperationChange: (op: LogicalOperation) => void;
	sourceId: number | null;
	onSourceIdChange: (id: number | null) => void;
	bypassMasking: boolean;
	onBypassMaskingChange: (v: boolean) => void;
}

// A = this (target) segment, B = the other (source) segment. Solid white =
// stays filled, dashed = stays/ends up empty, panel-bg fill = punched out.
// Same visual language as the islands/margin icons: solid = kept, dashed =
// empty, cross = removed.
function LogicalOpIcon({ op }: { op: LogicalOperation }) {
	const A = { cx: 7.5, cy: 10, r: 5.5 };
	const B = { cx: 12.5, cy: 10, r: 5.5 };

	switch (op) {
		case "copy":
			// Source shape becomes the target shape: dashed source on the left,
			// solid arrow, solid result on the right.
			return (
				<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
					<defs>
						<marker id="copy-arrow" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
							<path d="M0,0 L6,3 L0,6 Z" fill="#fff" />
						</marker>
					</defs>
					<rect x="1" y="6" width="7" height="7" rx="1.5" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" strokeDasharray="1.6,1.6" />
					<line x1="9.5" y1="9.5" x2="13.5" y2="9.5" stroke="#fff" strokeWidth="1.3" markerEnd="url(#copy-arrow)" />
					<rect x="14" y="6" width="6" height="7" rx="1.5" fill="#fff" />
				</svg>
			);
		case "add":
			// Union: both circles filled — overlapping the same solid fill reads
			// as one merged blob.
			return (
				<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
					<circle cx={A.cx} cy={A.cy} r={A.r} fill="#fff" fillOpacity="0.9" />
					<circle cx={B.cx} cy={B.cy} r={B.r} fill="#fff" fillOpacity="0.9" />
				</svg>
			);
		case "invert":
			// Everything filled except the segment's own shape — inside/outside
			// swapped, via an evenodd cutout.
			return (
				<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
					<path
						d="M1,1 H19 V19 H1 Z M10,4.5 A5.5,5.5 0 1 0 10,15.5 A5.5,5.5 0 1 0 10,4.5 Z"
						fill="#fff"
						fillRule="evenodd"
						opacity="0.9"
					/>
				</svg>
			);
		case "clear":
			// Empty, dashed outline with a cross through it — same "removed"
			// language used in the islands panel.
			return (
				<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
					<circle cx="10" cy="10" r="7" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" strokeDasharray="1.6,1.7" />
					<line x1="5.5" y1="5.5" x2="14.5" y2="14.5" stroke="#f43f5e" strokeWidth="1.4" strokeLinecap="round" />
					<line x1="5.5" y1="14.5" x2="14.5" y2="5.5" stroke="#f43f5e" strokeWidth="1.4" strokeLinecap="round" />
				</svg>
			);
		case "fill":
			// Fully solid — the whole segment (within the masking area) filled.
			return (
				<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
					<circle cx="10" cy="10" r="7" fill="#fff" />
				</svg>
			);
	}
}

const OPERATIONS: { value: LogicalOperation; label: string; tooltip: string; needsSource: boolean }[] = [
	{ value: "copy", label: "Copy", tooltip: "Replace this segment with another segment's shape.", needsSource: true },
	{ value: "add", label: "Add", tooltip: "Merge another segment into this one.", needsSource: true },
	{ value: "invert", label: "Invert", tooltip: "Swap this segment's filled and empty voxels.", needsSource: false },
	{ value: "clear", label: "Clear", tooltip: "Empty this segment completely.", needsSource: false },
	{ value: "fill", label: "Fill", tooltip: "Fill this segment completely (within the masking area).", needsSource: false },
];

// Plain-English sentence for each operation, built out of pieces so the
// target segment (always known) and source segment (picked from the
// dropdown, or blank until then) can be styled/rendered differently from
// the surrounding words. TARGET/SOURCE are placeholder tokens swapped for
// the actual segment-name chip at render time.
type SentencePart = "TARGET" | "SOURCE" | string;

const SENTENCE_TEMPLATES: Record<Exclude<LogicalOperation, "fill">, SentencePart[]> = {
	copy: ["Give ", "TARGET", " the exact shape ", "SOURCE", " currently has, discarding ", "TARGET", "'s old shape. ", "SOURCE", "'s voxels become ", "TARGET", "."],
	add: ["Merge ", "SOURCE", " into ", "TARGET", ". ", "SOURCE", "'s voxels become ", "TARGET", ", added on top of ", "TARGET", "'s existing shape."],
	invert: ["Swap ", "TARGET", "'s filled and empty voxels."],
	clear: ["Empty ", "TARGET", " completely."],
};

// Small mask glyph used inside the bypass-masking switch knob. Solid/opaque
// when masking is respected (the mask is "on"), shown with a diagonal slash
// when bypassed ("off"), so the icon alone communicates the current state.
function MaskIcon({ active }: { active: boolean }) {
	const color = active ? "#0b3b2e" : "rgba(255,255,255,0.55)";
	return (
		<svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" style={{ flexShrink: 0 }}>
			<rect x="2.5" y="2.5" width="15" height="15" rx="5" fill="none" stroke={color} strokeWidth="1.6" />
			<circle cx="7.6" cy="8.2" r="1.4" fill={color} />
			<circle cx="12.4" cy="8.2" r="1.4" fill={color} />
			<path d="M6.5,12.5 Q10,15 13.5,12.5" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
			{!active && <line x1="3" y1="17" x2="17" y2="3" stroke="#f43f5e" strokeWidth="1.6" strokeLinecap="round" />}
		</svg>
	);
}

export default function LogicalOperatorsPanel({
	segments,
	targetSegmentId,
	onApply,
	operation,
	onOperationChange,
	sourceId,
	onSourceIdChange,
	bypassMasking,
	onBypassMaskingChange,
}: LogicalOperatorsPanelProps) {
	const opDef = OPERATIONS.find((o) => o.value === operation) ?? OPERATIONS[0];
	const otherSegments = segments.filter((s) => s.id !== targetSegmentId);
	const targetSegment = segments.find((s) => s.id === targetSegmentId);
	const sourceSegment = sourceId != null ? otherSegments.find((s) => s.id === sourceId) ?? null : null;

	const options: OperationOption<LogicalOperation>[] = OPERATIONS.map((o) => ({
		value: o.value,
		label: o.label,
		tooltip: o.tooltip,
		icon: <LogicalOpIcon op={o.value} />,
	}));

	// A blank changing operation forgets whatever source was picked for the
	// previous one — a source chosen for "Subtract" has no guaranteed meaning
	// once you switch to "Intersect".
	const handleOperationChange = (next: LogicalOperation) => {
		onOperationChange(next);
		onSourceIdChange(null);
	};

	const sentenceChip = (kind: "target" | "source" | "blank", text: string, key: string | number) => (
		<span
			key={key}
			style={{
				display: "inline-block",
				fontWeight: 800,
				letterSpacing: kind === "blank" ? "0.05em" : "normal",
				color: kind === "target" ? "#86efac" : kind === "source" ? "#6ea8fe" : "#fbbf24",
				padding: kind === "blank" ? "0 2px" : 0,
			}}
		>
			{text}
		</span>
	);

	// Fill is the odd one out: it has no source, and its masking clause
	// depends on the bypass toggle rather than being fixed text.
	const renderFillSentence = () => {
		if (bypassMasking) {
			return [
				<span key="a">Fill the entire volume with </span>,
				sentenceChip("target", targetSegment?.label ?? "this segment", "target"),
				<span key="b">, overwriting any other segment in its way.</span>,
			];
		}
		return [
			<span key="a">Fill the entire volume with </span>,
			sentenceChip("target", targetSegment?.label ?? "this segment", "target"),
			<span key="b">, but only where voxels are empty or already </span>,
			sentenceChip("target", targetSegment?.label ?? "this segment", "target2"),
			<span key="c">.</span>,
		];
	};

	const renderSentence = () => {
		if (operation === "fill") return renderFillSentence();
		const template = SENTENCE_TEMPLATES[operation];
		return template.map((part, i) => {
			if (part === "TARGET") {
				return sentenceChip("target", targetSegment?.label ?? "this segment", i);
			}
			if (part === "SOURCE") {
				return sourceSegment ? sentenceChip("source", sourceSegment.label, i) : sentenceChip("blank", "___", i);
			}
			return <span key={i}>{part}</span>;
		});
	};

	return (
		<div className="seg-effect">
			<OperationPicker name="logical-op" options={options} value={operation} onChange={handleOperationChange} />

			{opDef.needsSource && (
				<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
					<span className="seg-effect__label">With segment:</span>
					<select
						className="seg-effect__select"
						value={sourceId ?? ""}
						onChange={(e) => onSourceIdChange(e.target.value === "" ? null : Number(e.target.value))}
						style={{
							background: "rgba(255,255,255,0.06)",
							border: "1px solid rgba(255,255,255,0.12)",
							borderRadius: 6,
							color: "#fff",
							padding: "7px 8px",
							fontSize: 12.5,
						}}
					>
						<option value="" disabled>
							Select a segment…
						</option>
						{otherSegments.map((s) => (
							<option key={s.id} value={s.id}>
								{s.label}
							</option>
						))}
					</select>
				</div>
			)}

			{/* Plain-English readout of what Apply will actually do. Fills in as
			    selections are made — starts with a blank until a source segment
			    is picked. Also spells out that SOURCE's voxels get absorbed into
			    TARGET (SOURCE loses that territory) — this is a single shared
			    label array, so copy/add don't leave the source untouched. */}
			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span className="seg-effect__label">What this does:</span>
				<div
					className="seg-effect__sentence"
					style={{
						fontSize: 12.5,
						lineHeight: 1.5,
						padding: "8px 10px",
						borderRadius: 8,
						background: "rgba(255,255,255,0.04)",
						border: "1px solid rgba(255,255,255,0.08)",
						color: "rgba(255,255,255,0.85)",
					}}
				>
					<div>{renderSentence()}</div>
					{opDef.needsSource && (
						<div style={{ marginTop: 4, color: "rgba(255,255,255,0.5)", fontStyle: "italic" }}>
							{sourceSegment ? sentenceChip("source", sourceSegment.label, "note-source") : sentenceChip("blank", "___", "note-source")}{" "}
							will lose those voxels — they now belong to {sentenceChip("target", targetSegment?.label ?? "this segment", "note-target")}.
						</div>
					)}
				</div>
			</div>

			{/* Bypass-masking switch — a real sliding toggle (track + knob) rather
			    than a checkbox, so it's unambiguous that it's clickable and what
			    state it's currently in. */}
			<div
				className="seg-effect__mask-toggle"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 10,
					background: "rgba(255,255,255,0.04)",
					border: "1px solid rgba(255,255,255,0.09)",
					borderRadius: 8,
					padding: "8px 10px",
				}}
			>
				<span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
					<span style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>
						{bypassMasking ? "Masking bypassed" : "Masking respected"}
					</span>
					<span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)" }}>
						{bypassMasking
							? "This operation ignores segment ownership and can overwrite any voxel, even ones another segment already owns."
							: "This operation can only touch empty voxels and this segment's own — it won't overwrite another segment's voxels."}
					</span>
				</span>
				<button
					type="button"
					role="switch"
					aria-checked={!bypassMasking}
					onClick={() => onBypassMaskingChange(!bypassMasking)}
					title={bypassMasking ? "Masking is bypassed — click to respect masking" : "Masking is respected — click to bypass it"}
					style={{
						position: "relative",
						flexShrink: 0,
						width: 44,
						height: 24,
						borderRadius: 12,
						border: "none",
						cursor: "pointer",
						padding: 0,
						background: bypassMasking ? "rgba(255,255,255,0.15)" : "#22c55e",
						transition: "background 0.15s ease",
					}}
				>
					<span
						style={{
							position: "absolute",
							top: 2,
							left: bypassMasking ? 2 : 22,
							width: 20,
							height: 20,
							borderRadius: "50%",
							background: bypassMasking ? "rgba(255,255,255,0.5)" : "#eafff2",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							transition: "left 0.15s ease, background 0.15s ease",
							boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
						}}
					>
						<MaskIcon active={!bypassMasking} />
					</span>
				</button>
			</div>

			<ApplyButton
				disabled={opDef.needsSource && sourceId === null}
				onApply={() => onApply(operation, opDef.needsSource ? sourceId : null, bypassMasking)}
			/>
		</div>
	);
}
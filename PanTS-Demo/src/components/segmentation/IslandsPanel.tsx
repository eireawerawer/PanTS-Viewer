import { useEffect, useRef, useState } from "react";
import ApplyButton from "../ApplyButton";
import OperationPicker, { type OperationOption } from "../OperationPicker";
import NumberSliderField from "../NumberSliderField";
import type { IslandsOperation } from "../../helpers/CornerstoneNifti2";

interface IslandsPanelProps {
	onApply: (operation: IslandsOperation, minimumSize: number) => void;
	pickingSelectedIsland: boolean;
	onPickSelectedIsland: () => void;
	/** Forgets whatever voxel was previously picked. Called whenever the operation
	 * changes or the target segment/organ changes, since a pick made for one
	 * doesn't carry any guaranteed meaning for another. */
	onResetPick: () => void;
	hasSelectedIsland: boolean;
	/** A voxel was clicked, but it isn't part of the segment this operation runs on. */
	pickedInvalid: boolean;
	/** Identifies the current target segment/organ — watched only to trigger a reset when it changes. */
	targetKey: number | null;
}

const MIN_SIZE_VOXELS = 1;
const MAX_SIZE_VOXELS = 20000;

// Three blobs of decreasing size stand in for "islands" in a segment. Each
// mode redraws them to show what happens: solid = kept as-is, faint dashed
// outline = removed, red X = explicitly deleted, ring = the picked island,
// distinct colors = split apart into separate segments.
function IslandsOpIcon({ op }: { op: IslandsOperation }) {
	const BIG = { cx: 7.4, cy: 8, r: 4.2 };
	const MED = { cx: 15, cy: 6.8, r: 2.5 };
	const SMALL = { cx: 13.2, cy: 15, r: 1.7 };

	const blob = (b: { cx: number; cy: number; r: number }, mode: "solid" | "dashed" | "x", color?: string) => {
		if (mode === "x") {
			return (
				<g key={`${b.cx}-${b.cy}`}>
					<circle cx={b.cx} cy={b.cy} r={b.r} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.1" strokeDasharray="1.4,1.6" />
					<line x1={b.cx - b.r * 0.7} y1={b.cy - b.r * 0.7} x2={b.cx + b.r * 0.7} y2={b.cy + b.r * 0.7} stroke="#f43f5e" strokeWidth="1.3" strokeLinecap="round" />
					<line x1={b.cx - b.r * 0.7} y1={b.cy + b.r * 0.7} x2={b.cx + b.r * 0.7} y2={b.cy - b.r * 0.7} stroke="#f43f5e" strokeWidth="1.3" strokeLinecap="round" />
				</g>
			);
		}
		if (mode === "dashed") {
			return <circle key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} r={b.r} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" strokeDasharray="1.4,1.6" />;
		}
		return <circle key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} r={b.r} fill={color ?? "#fff"} />;
	};

	let content: React.ReactNode;
	switch (op) {
		case "keepLargest":
			content = <>{blob(BIG, "solid")}{blob(MED, "dashed")}{blob(SMALL, "dashed")}</>;
			break;
		case "keepSelected":
			content = (
				<>
					{blob(BIG, "x")}
					{blob(MED, "solid")}
					<circle cx={MED.cx} cy={MED.cy} r={MED.r + 1.6} fill="none" stroke="#6ea8fe" strokeWidth="1.2" />
					{blob(SMALL, "x")}
				</>
			);
			break;
		case "removeSmall":
			content = <>{blob(BIG, "solid")}{blob(MED, "solid")}{blob(SMALL, "x")}</>;
			break;
		case "removeSelected":
			content = <>{blob(BIG, "solid")}{blob(MED, "x")}{blob(SMALL, "solid")}</>;
			break;
		case "splitToSegments":
			content = <>{blob(BIG, "solid", "#f43f5e")}{blob(MED, "solid", "#6ea8fe")}{blob(SMALL, "solid", "#eab308")}</>;
			break;
	}

	return (
		<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
			{content}
		</svg>
	);
}

const ISLANDS_OPTIONS: OperationOption<IslandsOperation>[] = [
	{
		value: "keepLargest",
		label: "Keep largest",
		tooltip: "Keep only the largest island in this segment — every smaller island is removed.",
		icon: <IslandsOpIcon op="keepLargest" />,
	},
	{
		value: "keepSelected",
		label: "Keep only picked",
		tooltip: "Click one island to pick it — every other island in this segment is deleted, leaving just the one you picked.",
		icon: <IslandsOpIcon op="keepSelected" />,
	},
	{
		value: "removeSmall",
		label: "Remove small",
		tooltip: "Remove every island in this segment smaller than the minimum size below.",
		icon: <IslandsOpIcon op="removeSmall" />,
	},
	{
		value: "removeSelected",
		label: "Remove picked",
		tooltip: "Click one island to pick it, then remove just that island — everything else in the segment is left alone.",
		icon: <IslandsOpIcon op="removeSelected" />,
	},
	{
		value: "splitToSegments",
		label: "Split to segments",
		tooltip: "Turn every island in this segment into its own new segment, each with its own color.",
		icon: <IslandsOpIcon op="splitToSegments" />,
	},
];

// Crosshair target used everywhere in the picker: a plain ring while idle, a
// pulsing red ring while armed and waiting for a click, a solid green ring
// with a checkmark once a valid pick lands, and a red ring with an X if the
// click landed outside the segment — so the icon alone tells you the state.
function PickIcon({ state }: { state: "idle" | "picking" | "picked" | "invalid" }) {
	const color = state === "picking" || state === "invalid" ? "#f43f5e" : state === "picked" ? "#22c55e" : "currentColor";
	return (
		<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
			<circle cx="8" cy="8" r="5" fill="none" stroke={color} strokeWidth="1.3" />
			<circle cx="8" cy="8" r="1" fill={color} />
			<line x1="8" y1="0.5" x2="8" y2="2.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
			<line x1="8" y1="13.5" x2="8" y2="15.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
			<line x1="0.5" y1="8" x2="2.5" y2="8" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
			<line x1="13.5" y1="8" x2="15.5" y2="8" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
			{state === "picking" && <circle cx="8" cy="8" r="5" fill="none" stroke="#f43f5e" strokeWidth="1.3" className="vp-livewire-close-pulse" />}
			{state === "picked" && (
				<path d="M5.2 8.3 L7.1 10.2 L11 6" fill="none" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
			)}
			{state === "invalid" && (
				<g>
					<line x1="5.8" y1="5.8" x2="10.2" y2="10.2" stroke="#f43f5e" strokeWidth="1.4" strokeLinecap="round" />
					<line x1="10.2" y1="5.8" x2="5.8" y2="10.2" stroke="#f43f5e" strokeWidth="1.4" strokeLinecap="round" />
				</g>
			)}
		</svg>
	);
}

// Small "click here" cursor glyph for the call-to-action buttons — reinforces
// that the next step happens in the viewport, not in this panel.
function ClickHintIcon() {
	return (
		<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
			<path d="M4 2.5 L4 12.8 L6.6 10.4 L8.3 13.7 L9.9 12.9 L8.2 9.6 L11.4 9.2 Z" fill="currentColor" />
		</svg>
	);
}

export default function IslandsPanel({
	onApply,
	pickingSelectedIsland,
	onPickSelectedIsland,
	onResetPick,
	hasSelectedIsland,
	pickedInvalid,
	targetKey,
}: IslandsPanelProps) {
	const [operation, setOperation] = useState<IslandsOperation>("keepLargest");
	const [minimumSize, setMinimumSize] = useState(1000);

	const needsSelectedIsland = operation === "keepSelected" || operation === "removeSelected";

	// A pick only ever makes sense for the exact operation + target segment it
	// was made for — switching either one forces a fresh pick rather than
	// silently carrying the old one over.
	const prevOperationRef = useRef(operation);
	useEffect(() => {
		if (prevOperationRef.current !== operation) onResetPick();
		prevOperationRef.current = operation;
	}, [operation, onResetPick]);

	const prevTargetRef = useRef(targetKey);
	useEffect(() => {
		if (prevTargetRef.current !== targetKey) onResetPick();
		prevTargetRef.current = targetKey;
	}, [targetKey, onResetPick]);

	const pickState: "idle" | "picking" | "picked" | "invalid" = pickingSelectedIsland
		? "picking"
		: pickedInvalid
			? "invalid"
			: hasSelectedIsland
				? "picked"
				: "idle";

	const applyReady = needsSelectedIsland && pickState === "picked";

	return (
		<div className="seg-effect">
			<OperationPicker name="islands-op" options={ISLANDS_OPTIONS} value={operation} onChange={setOperation} />

			{operation === "removeSmall" && (
				<NumberSliderField
					label="Minimum size"
					value={minimumSize}
					onChange={setMinimumSize}
					min={MIN_SIZE_VOXELS}
					max={MAX_SIZE_VOXELS}
					step={50}
					unit="voxels"
					ariaLabel="Minimum island size"
				/>
			)}

			{needsSelectedIsland && (
				<div className={`seg-effect__island-pick ${pickState === "invalid" ? "is-invalid" : ""} ${pickState === "picked" ? "is-picked" : ""}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					<span className="seg-effect__label" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
						<PickIcon state={pickState} />
						Pick your island
					</span>

					{pickState === "idle" && (
						<button className="seg-effect__pick" onClick={onPickSelectedIsland} style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center" }}>
							<ClickHintIcon />
							Start picking
						</button>
					)}

					{pickState === "picking" && (
						<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
							<button
								className="seg-effect__pick"
								onClick={onPickSelectedIsland}
								style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center", borderColor: "#f43f5e", color: "#fda4af" }}
							>
								<PickIcon state="picking" />
								Waiting for your click…
							</button>
							<span className="atb-flyout__hint">Click directly on the island in any 2D view (axial, sagittal, or coronal).</span>
						</div>
					)}

					{pickState === "picked" && (
						<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
							<span
								className="seg-effect__pick"
								style={{ display: "flex", alignItems: "center", gap: 7, borderColor: "#22c55e", color: "#86efac", cursor: "default", justifyContent: "center" }}
							>
								<PickIcon state="picked" />
								Island picked
							</span>
							<button
								className="seg-effect__pick"
								onClick={onPickSelectedIsland}
								title="Pick a different island"
								style={{ display: "flex", alignItems: "center", gap: 7, justifyContent: "center" }}
							>
								<ClickHintIcon />
								Pick again
							</button>
						</div>
					)}

					{pickState === "invalid" && (
						<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
							<span
								className="seg-effect__pick"
								style={{ display: "flex", alignItems: "center", gap: 7, borderColor: "#f43f5e", color: "#fda4af", cursor: "default", justifyContent: "center" }}
							>
								<PickIcon state="invalid" />
								Not part of this segment
							</span>
							<button
								className="seg-effect__pick"
								onClick={onPickSelectedIsland}
								style={{ borderColor: "#f43f5e", color: "#fda4af", display: "flex", alignItems: "center", gap: 7, justifyContent: "center" }}
							>
								<ClickHintIcon />
								Pick again
							</button>
							<span className="atb-flyout__hint">That click landed outside the active segment — pick a point inside it instead.</span>
						</div>
					)}
				</div>
			)}

			<div className={`seg-effect__apply-wrap ${applyReady ? "is-ready" : ""}`}>
				{applyReady && (
					<span
						className="seg-effect__apply-hint"
						style={{
							display: "block",
							marginBottom: 6,
							padding: "6px 8px",
							fontSize: 11.5,
							lineHeight: 1.4,
							textAlign: "center",
							color: "#86efac",
							background: "rgba(34,197,94,0.1)",
							border: "1px solid rgba(34,197,94,0.25)",
							borderRadius: 6,
						}}
					>
						Island selected — press Apply to run it.
					</span>
				)}
				<ApplyButton
					disabled={needsSelectedIsland && !hasSelectedIsland}
					onApply={() => {
						onApply(operation, minimumSize);
						// The pick only ever applies to one run — after Apply, whatever
						// was picked no longer describes the (now-changed) segment, so
						// forget it rather than leaving a stale "Island picked" state.
						onResetPick();
					}}
				/>
			</div>
		</div>
	);
}
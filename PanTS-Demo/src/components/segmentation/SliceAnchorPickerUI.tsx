// Small shared visual pieces for the guided click-to-pick slice flow.
// Flow: press the single green "Start" button → step 1's label highlights
// blue (plain text, not a button) → click on the canvas → it's replaced by
// a done chip and step 2's label highlights → click again → ready to apply.
// "Start over" clears everything back to the initial Start button.
import type { SliceAnchor } from "../../helpers/viewer/useSliceAnchorPicker";

const PANE_LABEL: Record<string, string> = { axial: "Axial", sagittal: "Sagittal", coronal: "Coronal" };

// "Axial - Slice 42" — consistent everywhere an anchor is shown.
export function formatAnchor(anchor: SliceAnchor): string {
	return `${PANE_LABEL[anchor.pane] ?? anchor.pane} - Slice ${anchor.sliceIndex + 1}`;
}

export function TargetIcon({ size = 16 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
			<circle cx="12" cy="12" r="3" fill="currentColor" />
			<path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
		</svg>
	);
}

export function PlayIcon({ size = 14 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path d="M6 4l14 8-14 8V4z" fill="currentColor" />
		</svg>
	);
}

export function CheckIcon({ size = 14 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
			<path d="M7 12.5l3 3 7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
		</svg>
	);
}

export function RefreshIcon({ size = 13 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path
				d="M4 4v5h5M20 20v-5h-5M4.5 15a8 8 0 0014.7 3.2M19.5 9A8 8 0 004.8 5.8"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				fill="none"
			/>
		</svg>
	);
}

export function ArrowIcon({ size = 16 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
		</svg>
	);
}

// The single entry point into the guided flow. Green, unmissable.
export function StartButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			className="seg-effect__apply"
			onClick={onClick}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				gap: 8,
				background: "#22c55e",
				color: "#08090b",
			}}
		>
			<PlayIcon /> Start
		</button>
	);
}

// One row of the 2-step wizard. Before it's picked: plain text (NOT a
// button — nothing to click here, the instruction is "click on the image"),
// highlighted blue only while it's the step currently needed. After it's
// picked: a small done chip with the resolved pane/slice.
export function StepLabel({ stepNumber, anchor, highlighted }: { stepNumber: 1 | 2; anchor: SliceAnchor | null; highlighted: boolean }) {
	if (anchor) {
		return (
			<div className="seg-effect__field">
				<span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--vp-text)" }}>
					<span style={{ color: "#22c55e", display: "flex" }}>
						<CheckIcon />
					</span>
					{formatAnchor(anchor)}
				</span>
			</div>
		);
	}
	return (
		<div
			className="seg-effect__field"
			style={{
				color: highlighted ? "#4da3ff" : "var(--vp-text-faint)",
				fontWeight: highlighted ? 700 : 400,
				transition: "color 0.15s",
			}}
		>
			{highlighted && (
				<span style={{ display: "flex", color: "#4da3ff" }}>
					<TargetIcon size={14} />
				</span>
			)}
			<span>{stepNumber === 1 ? "Click first slice" : "Click last slice"}</span>
		</div>
	);
}

// Fixed banner shown while a pick is armed, so the instruction travels with
// the user's eyes instead of sitting back in the flyout panel they've left.
export function PickingBanner({ label, onCancel }: { label: string; onCancel: () => void }) {
	return (
		<div
			role="status"
			style={{
				position: "fixed",
				top: 16,
				left: "50%",
				transform: "translateX(-50%)",
				zIndex: 1000,
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "8px 14px",
				borderRadius: 999,
				background: "rgba(20,20,24,0.92)",
				color: "#fff",
				fontSize: 13,
				boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
				pointerEvents: "auto",
			}}
		>
			<span style={{ display: "flex", alignItems: "center", color: "#4da3ff" }}>
				<TargetIcon />
			</span>
			<span>{label}</span>
			<button
				type="button"
				onClick={onCancel}
				aria-label="Cancel picking"
				style={{
					background: "transparent",
					border: "none",
					color: "#aaa",
					cursor: "pointer",
					fontSize: 16,
					lineHeight: 1,
					padding: 2,
				}}
			>
				×
			</button>
		</div>
	);
}

// Single, unambiguous way to clear both picked anchors and go all the way
// back to the initial Start button.
export function StartOverButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				alignSelf: "flex-start",
				display: "flex",
				alignItems: "center",
				gap: 6,
				background: "transparent",
				border: "1px solid var(--vp-border)",
				borderRadius: 8,
				color: "var(--vp-text-dim)",
				padding: "5px 10px",
				fontSize: 11.5,
				cursor: "pointer",
			}}
		>
			<RefreshIcon /> Start over
		</button>
	);
}
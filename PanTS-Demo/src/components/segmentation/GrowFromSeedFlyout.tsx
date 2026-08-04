import { useEffect, useState } from "react";
import type { useSmartFill } from "../../helpers/viewer/useSmartFill";
import ApplyButton from "../ApplyButton";
import OperationPicker, { type OperationOption } from "../OperationPicker";

type SmartFill = ReturnType<typeof useSmartFill>;

// If your useSmartFill hook can report whether any foreground/background
// scribbles actually exist, wire them up here (optional — see the two
// commented lines in the Pick<> below and where hasForegroundMarks /
// hasBackgroundMarks are read). Without them, "Continue" is a manual
// self-report step; with them, this component enforces it for real and
// shows an inline error if you try to move on with nothing marked.
type GrowFromSeedsFlyoutProps = Pick<SmartFill, "markMode" | "setMarkMode" | "scope" | "setScope" | "apply" | "clearScribbles"> & {
	hasForegroundMarks?: boolean;
	hasBackgroundMarks?: boolean;
};

type Step = 1 | 2 | 3;

// Two flat "plane" icons for scope: one slice highlighted vs. the whole
// stack highlighted — same visual language as the islands panel's blobs.
function ScopeIcon({ scope }: { scope: "slice" | "volume" }) {
	if (scope === "slice") {
		return (
			<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
				<rect x="2" y="7" width="16" height="6" rx="1.2" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" strokeDasharray="1.4,1.6" />
				<rect x="2" y="1" width="16" height="6" rx="1.2" fill="#fff" />
				<rect x="2" y="13" width="16" height="6" rx="1.2" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" strokeDasharray="1.4,1.6" />
			</svg>
		);
	}
	return (
		<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
			<rect x="2" y="1" width="16" height="5.3" rx="1.1" fill="#fff" fillOpacity="0.9" />
			<rect x="2" y="7.3" width="16" height="5.3" rx="1.1" fill="#fff" fillOpacity="0.9" />
			<rect x="2" y="13.7" width="16" height="5.3" rx="1.1" fill="#fff" fillOpacity="0.9" />
		</svg>
	);
}

const SCOPE_OPTIONS: OperationOption<"slice" | "volume">[] = [
	{ value: "slice", label: "Current slice", tooltip: "Only fill on the slice you're currently viewing.", icon: <ScopeIcon scope="slice" /> },
	{ value: "volume", label: "All slices", tooltip: "Fill across the whole volume.", icon: <ScopeIcon scope="volume" /> },
];

// Step 1 icon: a dot landing inside a solid blob.
function MarkInsideIcon({ size = 34 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 40 40">
			<circle cx="20" cy="20" r="14" fill="#6ea8fe" fillOpacity="0.18" stroke="#6ea8fe" strokeWidth="1.4" />
			<circle cx="17" cy="19" r="2.6" fill="#6ea8fe" />
			<circle cx="23" cy="23" r="2.6" fill="#6ea8fe" />
			<circle cx="22" cy="15" r="2.6" fill="#6ea8fe" />
		</svg>
	);
}

// Step 2 icon: a dot landing outside the blob, with a small "excluded" ring.
function MarkOutsideIcon({ size = 34 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 40 40">
			<circle cx="17" cy="19" r="12" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.4" strokeDasharray="1.6,1.8" />
			<circle cx="31" cy="12" r="2.6" fill="#f43f5e" />
			<circle cx="33" cy="27" r="2.6" fill="#f43f5e" />
			<line x1="28.5" y1="9.5" x2="33.5" y2="14.5" stroke="#f43f5e" strokeWidth="1" strokeLinecap="round" opacity="0" />
		</svg>
	);
}

// Step 3 icon: the region fully filled solid — the end state.
function FillReadyIcon({ size = 34 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 40 40">
			<circle cx="20" cy="20" r="14" fill="#22c55e" fillOpacity="0.9" />
			<path d="M14 20.5 L18 24.5 L26 15.5" fill="none" stroke="#0b3b2e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

// Progress rail — three dots connected by a line, current step highlighted,
// done steps checked. Built as a CSS grid (dot / line / dot / line / dot)
// rather than dots-over-an-absolutely-positioned-line, so the connector
// physically cannot render on top of a dot's number — it occupies its own
// grid track between them, never overlapping. Purely visual orientation,
// not clickable (you move forward/back only via the step buttons).
function StepRail({ step }: { step: Step }) {
	const state = (n: Step) => (n < step ? "done" : n === step ? "current" : "upcoming");
	const labels = ["Mark inside", "Mark outside", "Fill"];

	const dotStyle = (n: Step): React.CSSProperties => {
		const s = state(n);
		return {
			width: 22,
			height: 22,
			borderRadius: "50%",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			fontSize: 11,
			fontWeight: 700,
			justifySelf: "center",
			background: s === "current" ? "#6ea8fe" : s === "done" ? "#22c55e" : "rgba(255,255,255,0.08)",
			color: s === "upcoming" ? "rgba(255,255,255,0.4)" : "#0b1620",
			border: s === "upcoming" ? "1px solid rgba(255,255,255,0.18)" : "none",
		};
	};

	const lineStyle = (done: boolean): React.CSSProperties => ({
		height: 2,
		alignSelf: "center",
		background: done ? "#22c55e" : "rgba(255,255,255,0.12)",
	});

	const labelStyle = (n: Step): React.CSSProperties => ({
		fontSize: 9.5,
		textAlign: "center",
		color: state(n) === "upcoming" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.75)",
	});

	return (
		<div style={{ display: "grid", gridTemplateColumns: "22px 1fr 22px 1fr 22px", rowGap: 4 }}>
			<div style={dotStyle(1)}>{state(1) === "done" ? "✓" : 1}</div>
			<div style={lineStyle(step > 1)} />
			<div style={dotStyle(2)}>{state(2) === "done" ? "✓" : 2}</div>
			<div style={lineStyle(step > 2)} />
			<div style={dotStyle(3)}>{state(3) === "done" ? "✓" : 3}</div>
			<span style={labelStyle(1)}>{labels[0]}</span>
			<span />
			<span style={labelStyle(2)}>{labels[1]}</span>
			<span />
			<span style={labelStyle(3)}>{labels[2]}</span>
		</div>
	);
}

const stepCardStyle: React.CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: 8,
	textAlign: "center",
	padding: "14px 12px",
	borderRadius: 10,
	background: "rgba(255,255,255,0.04)",
	border: "1px solid rgba(255,255,255,0.08)",
};

const primaryBtnStyle: React.CSSProperties = {
	width: "100%",
	padding: "9px 10px",
	borderRadius: 8,
	border: "none",
	background: "#6ea8fe",
	color: "#0b1620",
	fontWeight: 700,
	fontSize: 12.5,
	cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
	width: "100%",
	padding: "8px 10px",
	borderRadius: 8,
	border: "1px solid rgba(255,255,255,0.15)",
	background: "transparent",
	color: "rgba(255,255,255,0.75)",
	fontSize: 12,
	cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
	fontSize: 11.5,
	color: "#fda4af",
	background: "rgba(244,63,94,0.1)",
	border: "1px solid rgba(244,63,94,0.3)",
	borderRadius: 6,
	padding: "6px 8px",
};

export default function GrowFromSeedsFlyout({
	setMarkMode, scope, setScope, apply, clearScribbles,
	hasForegroundMarks, hasBackgroundMarks,
}: GrowFromSeedsFlyoutProps) {
	const [step, setStep] = useState<Step>(1);
	const [error, setError] = useState<string | null>(null);

	// The step drives markMode — the user never toggles it directly. Step 1 =
	// marking what to include, step 2 = marking what to exclude.
	useEffect(() => {
		if (step === 1) setMarkMode("fg");
		else if (step === 2) setMarkMode("bg");
	}, [step, setMarkMode]);

	const handleStartOver = () => {
		clearScribbles();
		setStep(1);
		setError(null);
	};

	// Switching scope mid-flow means everything marked so far was placed under
	// the old scope (this slice vs. the whole volume) and no longer means what
	// the user thinks it means — so it's discarded, not carried over.
	const handleScopeChange = (next: typeof scope) => {
		handleStartOver();
		setScope(next);
	};

	const handleContinueFromInside = () => {
		if (hasForegroundMarks === false) {
			setError("Click at least one point inside the region before continuing.");
			return;
		}
		setError(null);
		setStep(2);
	};

	const handleSkipOutside = () => {
		if (hasBackgroundMarks === true) {
			setError("You've marked points to exclude — click Continue instead, or Start over to clear them.");
			return;
		}
		setError(null);
		setStep(3);
	};

	const handleFill = async () => {
		if (hasForegroundMarks === false) {
			setError("Nothing was marked — click Start over and mark at least one point inside the region first.");
			return;
		}
		setError(null);
		await apply();
		// A committed fill consumes the marks that produced it — starting the
		// next fill from a clean step 1 rather than leaving stale scribbles
		// and a "step 3" state that no longer matches what's on screen.
		handleStartOver();
	};

	return (
		<div className="seg-effect">
			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span className="seg-effect__label">Scope:</span>
				<OperationPicker name="smartfill-scope" title="" options={SCOPE_OPTIONS} value={scope} onChange={handleScopeChange} />
			</div>

			<StepRail step={step} />

			{step === 1 && (
				<div style={stepCardStyle}>
					<MarkInsideIcon />
					<div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>Click inside the region</div>
					<div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>
						Drop a few points anywhere inside what you want to fill. More points in different spots works better than one.
					</div>
					{error && <div style={errorStyle}>{error}</div>}
					<button style={primaryBtnStyle} onClick={handleContinueFromInside}>
						I've marked inside — continue
					</button>
				</div>
			)}

			{step === 2 && (
				<div style={stepCardStyle}>
					<MarkOutsideIcon />
					<div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>Click anything to exclude</div>
					<div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>
						Optional. If a neighboring structure keeps bleeding in, dot it here to keep it out. Skip this if you don't need it.
					</div>
					{error && <div style={errorStyle}>{error}</div>}
					<button style={primaryBtnStyle} onClick={() => {
						if (hasBackgroundMarks === false) {
							setError("Click at least one point to exclude, or use Skip if there's nothing to exclude.");
							return;
						}
						setError(null);
						setStep(3);
					}}>
						I've marked outside — continue
					</button>
					<button style={secondaryBtnStyle} onClick={handleSkipOutside}>
						Skip — nothing to exclude
					</button>
					<button style={{ ...secondaryBtnStyle, border: "none", color: "rgba(255,255,255,0.45)" }} onClick={() => setStep(1)}>
						Back
					</button>
				</div>
			)}

			{step === 3 && (
				<div style={stepCardStyle}>
					<FillReadyIcon />
					<div style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>Ready to fill</div>
					<div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.4 }}>
						This grows outward from your inside points, staying clear of anything marked outside, {scope === "slice" ? "on the current slice." : "across all slices."}
					</div>
					{error && <div style={errorStyle}>{error}</div>}
					<div style={{ width: "100%" }}>
						<ApplyButton onApply={handleFill} label="Fill" applyingLabel="Filling…" />
					</div>
					<button style={{ ...secondaryBtnStyle, border: "none", color: "rgba(255,255,255,0.45)" }} onClick={() => setStep(2)}>
						Back
					</button>
				</div>
			)}

			<button
				style={{ ...secondaryBtnStyle, marginTop: 2, fontSize: 11, color: "rgba(255,255,255,0.4)" }}
				onClick={handleStartOver}
				title="Clear everything marked so far and start from step 1"
			>
				Start over
			</button>
		</div>
	);
}
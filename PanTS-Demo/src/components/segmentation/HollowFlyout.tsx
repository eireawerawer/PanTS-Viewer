import { useState } from "react";
import "./SegmentEffectPanel.css"

import ApplyButton from "../ApplyButton";
import OperationPicker, { type OperationOption } from "../OperationPicker";
import NumberSliderField from "../NumberSliderField";
import { applyHollow, getActualHollowMm } from "../../helpers/CornerstoneNifti2";
import type { HollowSurface, MaskFilter } from "../../helpers/CornerstoneNifti2";

interface Props {
	segmentIndex: number;
	maskFilter: MaskFilter;
	onLog?: (detail: string) => void;
}

// A shell drawn as a plain stroked ring (stroke-width = shell thickness) is
// enough to read at a glance; the dashed circle behind it is always the
// *original* segment boundary, so where the solid ring sits relative to the
// dashed line is the entire explanation — same "solid = result, dashed =
// original" language MarginOpIcon already uses.
function HollowOpIcon({ surface }: { surface: HollowSurface }) {
	const originalR = 6;
	const thickness = 2.6;
	const ringCenterR =
		surface === "inside" ? originalR - thickness / 2 :
		surface === "outside" ? originalR + thickness / 2 :
		originalR; // medial — centered on the original boundary

	return (
		<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
			<circle cx="10" cy="10" r={originalR} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.1" strokeDasharray="1.4,1.7" />
			<circle cx="10" cy="10" r={ringCenterR} fill="none" stroke="#fff" strokeWidth={thickness} />
		</svg>
	);
}

const HOLLOW_OPTIONS: OperationOption<HollowSurface>[] = [
	{ value: "inside", label: "Inside surface", tooltip: "The current segment becomes the outside of the shell — it's hollowed out from within.", icon: <HollowOpIcon surface="inside" /> },
	{ value: "medial", label: "Medial surface", tooltip: "The current boundary runs through the middle of the shell — it grows half-in, half-out.", icon: <HollowOpIcon surface="medial" /> },
	{ value: "outside", label: "Outside surface", tooltip: "The current segment becomes the inside of the shell — it grows outward into a shell around it.", icon: <HollowOpIcon surface="outside" /> },
];

const MIN_THICKNESS_MM = 0.1;
// Most shell use-cases (organ/vessel walls, printable casings) fall well
// under this; capping here keeps the slider precise at the sizes people
// actually use instead of spreading its range across values no one needs.
const MAX_THICKNESS_MM = 20;

export default function HollowFlyout({ segmentIndex, maskFilter, onLog }: Props) {
	const [surface, setSurface] = useState<HollowSurface>("inside");
	const [thicknessMm, setThicknessMm] = useState(3);
	const [applying, setApplying] = useState(false);

	// NumberSliderField already keeps the value clamped to [min, max] as the
	// user types/drags, so thicknessMm is always a valid number in range —
	// nothing extra to guard before Apply.
	const actual = getActualHollowMm(thicknessMm);

	const run = () => {
		setApplying(true);
		try {
			const r = applyHollow(surface, thicknessMm, 6, maskFilter);
			if (r?.changedVoxels) {
				onLog?.(`Hollowed (${surface} surface, ${thicknessMm}mm) — ${r.changedVoxels.toLocaleString()} vox`);
			} else {
				onLog?.("Hollow did nothing — segment may be too thin for this shell thickness.");
			}
		} finally {
			setApplying(false);
		}
	};

	return (
		<div className="seg-effect">
			<OperationPicker name="hollow-surface" options={HOLLOW_OPTIONS} value={surface} onChange={setSurface} />

			<NumberSliderField
				label="Shell thickness"
				value={thicknessMm}
				onChange={setThicknessMm}
				min={MIN_THICKNESS_MM}
				max={MAX_THICKNESS_MM}
				step={0.1}
				unit="mm"
				ariaLabel="Shell thickness"
			/>


			<ApplyButton disabled={applying} onApply={run} />
		</div>
	);
}
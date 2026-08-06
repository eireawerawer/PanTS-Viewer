import OperationPicker, { type OperationOption } from "../OperationPicker";
import NumberSliderField from "../NumberSliderField";
import type { LevelTraceOperation } from "../../helpers/CornerstoneNifti2";

interface Props {
	operation: LevelTraceOperation;
	onOperationChange: (op: LevelTraceOperation) => void;
	toleranceHu: number;
	onToleranceChange: (hu: number) => void;
}

// Same visual language as the Scissors tool's op icons: a square stands in
// for "the slice", the circle for "the traced region". Solid fill = ends up
// part of the segment, dashed-only = ends up cleared. Inside vs outside just
// mirrors which side of the circle gets touched.
function LevelTraceOpIcon({ op }: { op: LevelTraceOperation }) {
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

const LEVEL_TRACE_OPTIONS: OperationOption<LevelTraceOperation>[] = [
	{ value: "fillInside", label: "Fill inside", tooltip: "Fill the traced region into the active segment.", icon: <LevelTraceOpIcon op="fillInside" /> },
	{ value: "fillOutside", label: "Fill outside", tooltip: "Fill everything on this slice OUTSIDE the traced region into the active segment.", icon: <LevelTraceOpIcon op="fillOutside" /> },
	{ value: "eraseInside", label: "Erase inside", tooltip: "Clear the active segment wherever it falls inside the traced region.", icon: <LevelTraceOpIcon op="eraseInside" /> },
	{ value: "eraseOutside", label: "Erase outside", tooltip: "Clear the active segment everywhere on this slice OUTSIDE the traced region.", icon: <LevelTraceOpIcon op="eraseOutside" /> },
];

const MIN_SENSITIVITY_HU = 5;
// Past ~300 HU the trace is effectively grabbing half the intensity range in
// a typical CT — wide enough to cover "loosest useful setting" without the
// slider wasting resolution on values nobody wants.
const MAX_SENSITIVITY_HU = 300;

export default function LevelTracingFlyout({ operation, onOperationChange, toleranceHu, onToleranceChange }: Props) {
	return (
		<div className="seg-effect">
			<span className="seg-effect__desc">
				Hover to preview the region of matching intensity, click to apply it.
			</span>

			<OperationPicker name="level-trace-op" options={LEVEL_TRACE_OPTIONS} value={operation} onChange={onOperationChange} />

			<NumberSliderField
				label="Sensitivity"
				value={toleranceHu}
				onChange={onToleranceChange}
				min={MIN_SENSITIVITY_HU}
				max={MAX_SENSITIVITY_HU}
				step={5}
				unit="HU"
				ariaLabel="Level tracing sensitivity"
			/>

			<span className="seg-effect__hint">Higher sensitivity traces a wider range of intensities around the cursor.</span>
		</div>
	);
}
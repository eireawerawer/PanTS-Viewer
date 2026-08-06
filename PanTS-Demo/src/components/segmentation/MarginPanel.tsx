import { useState } from "react";
import ApplyButton from "../ApplyButton";
import OperationPicker, { type OperationOption } from "../OperationPicker";
import NumberSliderField from "../NumberSliderField";

export type MarginOperation = "grow" | "shrink";
export type EditableArea = "everywhere" | "insideAllSegments" | "insideVisibleSegments" | "insideSegment" | "outsideAllSegments" | "outsideVisibleSegments";

interface MarginPanelProps {
	onApply: (operation: MarginOperation, marginMm: number) => void;
	actualMm: [number, number, number] | null;
	actualVoxels: [number, number, number] | null;
}

const MAX_MARGIN_MM = 3;
const MIN_MARGIN_MM = 0;

// Solid ring = the new boundary, faint dashed ring = the original boundary.
// Arrows point the direction the boundary actually moves, so grow/shrink
// read the same way the scissors inside/outside icons do.
function MarginOpIcon({ op }: { op: MarginOperation }) {
	const grow = op === "grow";
	const outerR = grow ? 7.2 : 4.6;
	const innerR = grow ? 4.6 : 7.2;

	const arrow = (angle: number) => {
		const rad = (angle * Math.PI) / 180;
		const from = grow ? innerR + 0.8 : outerR + 3.6;
		const to = grow ? outerR + 3.4 : innerR + 0.8;
		return {
			x1: 10 + from * Math.cos(rad),
			y1: 10 + from * Math.sin(rad),
			x2: 10 + to * Math.cos(rad),
			y2: 10 + to * Math.sin(rad),
		};
	};

	return (
		<svg width="20" height="20" viewBox="0 0 20 20" className="atb-scissors-icon">
			<defs>
				<marker id={`margin-arrow-${op}`} markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
					<path d="M0,0 L6,3 L0,6 Z" fill="#fff" />
				</marker>
			</defs>
			<circle cx="10" cy="10" r={innerR} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" strokeDasharray="1.5,1.8" />
			<circle cx="10" cy="10" r={outerR} fill="none" stroke="#fff" strokeWidth="1.5" />
			{[0, 90, 180, 270].map((angle) => {
				const { x1, y1, x2, y2 } = arrow(angle);
				return (
					<line
						key={angle}
						x1={x1}
						y1={y1}
						x2={x2}
						y2={y2}
						stroke="#fff"
						strokeWidth="1.3"
						strokeLinecap="round"
						markerEnd={`url(#margin-arrow-${op})`}
					/>
				);
			})}
		</svg>
	);
}

const MARGIN_OPTIONS: OperationOption<MarginOperation>[] = [
	{ value: "grow", label: "Grow", tooltip: "Expand the segment boundary outward by the margin.", icon: <MarginOpIcon op="grow" /> },
	{ value: "shrink", label: "Shrink", tooltip: "Pull the segment boundary inward by the margin.", icon: <MarginOpIcon op="shrink" /> },
];

export default function MarginPanel({ onApply }: MarginPanelProps) {
	const [operation, setOperation] = useState<MarginOperation>("grow");
	const [marginMm, setMarginMm] = useState(1.5);

	return (
		<div className="seg-effect">
			<OperationPicker name="margin-op" options={MARGIN_OPTIONS} value={operation} onChange={setOperation} />

			<NumberSliderField
				label="Margin"
				value={marginMm}
				onChange={setMarginMm}
				min={MIN_MARGIN_MM}
				max={MAX_MARGIN_MM}
				step={0.1}
				unit="mm"
				ariaLabel="Margin size"
			/>

			<ApplyButton onApply={() => onApply(operation, marginMm)} />
		</div>
	);
}
import { useState } from "react";
import ApplyButton from "../ApplyButton";
import NumberSliderField from "../NumberSliderField";
import type { SmoothingMethod } from "../../helpers/CornerstoneNifti2";

interface Props {
	onApply: (method: SmoothingMethod, kernelMm: number) => void;
}

const MAX_KERNEL_MM = 3;
const MIN_KERNEL_MM = 0.5;

export default function SmoothingFlyout({ onApply }: Props) {
	const [kernelMm, setKernelMm] = useState(3);

	return (
		<div className="seg-effect">
			<div className="seg-effect__desc">Make segment boundaries smoother.</div>

			<NumberSliderField
				label="Kernel size"
				value={kernelMm}
				onChange={setKernelMm}
				min={MIN_KERNEL_MM}
				max={MAX_KERNEL_MM}
				step={0.1}
				unit="mm"
				ariaLabel="Smoothing kernel size"
			/>

			<ApplyButton onApply={() => onApply("median", kernelMm)} />
		</div>
	);
}
import { useEffect, useState } from "react";
import { interpolateSegmentBetweenSlices, setPaneSliceIndex } from "../../helpers/CornerstoneNifti2";
import type { MaskFilter, CinePane } from "../../helpers/CornerstoneNifti2";
import { useSliceAnchorPicker } from "../../helpers/viewer/useSliceAnchorPicker";
import { StartButton, StepLabel, PickingBanner, StartOverButton, ArrowIcon } from "./SliceAnchorPickerUI";

interface Props {
	pane: CinePane;
	totalSlices: number;
	segmentIndex: number;
	maskFilter: MaskFilter;
	onLog?: (detail: string) => void;
}

export default function FillBetweenSlicesFlyout({ segmentIndex, maskFilter, onLog }: Props) {
	// Surfaced inline right under the picking banner whenever a click lands on
	// a slice that doesn't satisfy the current step's requirement (first or
	// last slice missing the drawn shape). Clears itself as soon as a valid
	// slice is picked — i.e. as soon as `first`/`last`/`phase` actually change.
	const [pickError, setPickError] = useState<string | null>(null);

	// Interpolation needs the shape drawn on BOTH end slices to build the
	// in-between shapes from — unlike copy, the last click also requires it.
	const picker = useSliceAnchorPicker({
		segmentIndex,
		lastRequiresSegment: true,
		onError: (d) => { setPickError(d); onLog?.(d); },
	});
	const { phase, step, first, last } = picker;

	useEffect(() => {
		setPickError(null);
	}, [phase, step, first, last]);

	const run = () => {
		if (!first || !last) return;
		const result = interpolateSegmentBetweenSlices(first.pane, first.sliceIndex, last.sliceIndex, segmentIndex, maskFilter);
		if (result?.changedVoxels) {
			onLog?.(`Interpolated ${result.slicesWritten} slices (${result.changedVoxels.toLocaleString()} vox)`);
			setPaneSliceIndex(last.pane, last.sliceIndex);
		} else {
			onLog?.("Interpolation did nothing — draw the shape fully on both slices first.");
		}
		picker.reset();
	};

	return (
		<div className="seg-effect">
			<div className="seg-effect__desc">Fill in the shape between two drawn slices.</div>

			{phase === "idle" ? (
				<StartButton onClick={picker.startPicking} />
			) : (
				<>
					<StepLabel stepNumber={1} anchor={first} highlighted={!first && phase === "picking" && step === "first"} />
					<StepLabel stepNumber={2} anchor={last} highlighted={!!first && !last && phase === "picking" && step === "last"} />

					{phase === "ready" && (
						<button
							className="seg-effect__apply"
							onClick={run}
							style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
						>
							Interpolate <ArrowIcon />
						</button>
					)}

					<StartOverButton onClick={picker.reset} />
				</>
			)}

			{phase === "picking" && (
				<PickingBanner
					label={step === "first" ? "Click the shape on the first slice" : "Click the shape on the last slice"}
					onCancel={picker.cancelPicking}
				/>
			)}

			{pickError && <div className="seg-effect__error">{pickError}</div>}
		</div>
	);
}
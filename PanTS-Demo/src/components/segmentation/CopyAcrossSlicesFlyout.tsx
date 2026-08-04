import { useEffect, useState } from "react";
import "./SegmentEffectPanel.css"
import { copySegmentAcrossSlices, setPaneSliceIndex } from "../../helpers/CornerstoneNifti2";
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

export default function CopyAcrossSlicesFlyout({ segmentIndex, maskFilter, onLog }: Props) {
	// Surfaced inline right under the picking banner whenever a click lands on
	// a slice that doesn't satisfy the current step's requirement (e.g. the
	// source slice has no drawn shape). It clears itself the moment a valid
	// slice is picked — i.e. as soon as `first`/`last`/`phase` actually change.
	const [pickError, setPickError] = useState<string | null>(null);

	// The destination (last) slice is where the copy is going TO — it's
	// expected to be empty, so the last click only needs to land on a valid
	// slice in the same pane, not on an existing drawing.
	const picker = useSliceAnchorPicker({
		segmentIndex,
		lastRequiresSegment: false,
		onError: (d) => { setPickError(d); onLog?.(d); },
	});
	const { phase, step, first, last } = picker;

	useEffect(() => {
		setPickError(null);
	}, [phase, step, first, last]);

	const run = () => {
		if (!first || !last) return;
		const result = copySegmentAcrossSlices(first.pane, first.sliceIndex, last.sliceIndex, segmentIndex, maskFilter);
		if (result?.changedVoxels) {
			onLog?.(`Copied across ${result.slicesWritten} slices (${result.changedVoxels.toLocaleString()} vox)`);
			setPaneSliceIndex(last.pane, last.sliceIndex);
		} else {
			onLog?.("Copy failed — draw the shape fully on the first slice first.");
		}
		picker.reset();
	};

	return (
		<div className="seg-effect">
			<div className="seg-effect__desc">Copy a shape from one slice to every slice up to another.</div>

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
							Copy across slices <ArrowIcon />
						</button>
					)}

					<StartOverButton onClick={picker.reset} />
				</>
			)}

			{phase === "picking" && (
				<PickingBanner
					label={step === "first" ? "Click the shape on the source slice" : "Click the destination slice"}
					onCancel={picker.cancelPicking}
				/>
			)}

			{pickError && <div className="seg-effect__error">{pickError}</div>}
		</div>
	);
}
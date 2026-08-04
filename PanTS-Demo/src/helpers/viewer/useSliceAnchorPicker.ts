// useSliceAnchorPicker.ts
//
// Powers the guided "click the shape on the first/last slice" flow shared by
// CopyAcrossSlicesFlyout and FillBetweenSlicesFlyout. The user never types a
// pane name or a slice number — they click directly in whichever pane it's
// easiest to see the organ in, and this resolves pane + slice index for them
// via pickSliceAnchorAtClientPoint.
import { useEffect, useRef, useState } from "react";
import { pickSliceAnchorAtClientPoint, type CinePane } from "../CornerstoneNifti2";

export type SliceAnchor = { pane: CinePane; sliceIndex: number };
type Step = "first" | "last";
type Phase = "idle" | "picking" | "ready";

interface Options {
	segmentIndex: number;
	/**
	 * Does the LAST click also need to land on an existing drawing of the
	 * segment? True for interpolation (both ends must already be drawn).
	 * False for copy (the destination slice is expected to be empty —
	 * that's the point of copying there), where the last click just needs
	 * to land on a valid slice in the same pane.
	 */
	lastRequiresSegment: boolean;
	/** Every rejected click (wrong spot, wrong pane, same slice, etc.) is reported here — never silent. */
	onError: (detail: string) => void;
}

export function useSliceAnchorPicker({ segmentIndex, lastRequiresSegment, onError }: Options) {
	const [step, setStep] = useState<Step>("first");
	const [phase, setPhase] = useState<Phase>("idle");
	const [first, setFirst] = useState<SliceAnchor | null>(null);
	const [last, setLast] = useState<SliceAnchor | null>(null);
	const stepRef = useRef(step);
	stepRef.current = step;
	const firstRef = useRef(first);
	firstRef.current = first;

	useEffect(() => {
		if (phase !== "picking") return;

		const onClick = (e: PointerEvent) => {
			const hit = pickSliceAnchorAtClientPoint(e.clientX, e.clientY);
			if (!hit) {
				onError("Click inside one of the image panes.");
				return;
			}
			e.preventDefault();
			e.stopPropagation();

			const isFirstStep = stepRef.current === "first";
			const needsSegment = isFirstStep || lastRequiresSegment;
			if (needsSegment && hit.segmentAtPoint !== segmentIndex) {
				onError(
					isFirstStep
						? "Nothing drawn there — click directly on the shape you want to copy/fill from."
						: "Nothing drawn there — click directly on the shape on this slice."
				);
				return;
			}

			if (isFirstStep) {
				setFirst({ pane: hit.pane, sliceIndex: hit.sliceIndex });
				setStep("last");
				return; // stay in picking mode for the second click
			}

			// step === "last"
			if (firstRef.current && hit.pane !== firstRef.current.pane) {
				onError(`Click in the same view (${firstRef.current.pane}) as the first slice.`);
				return;
			}
			if (firstRef.current && hit.sliceIndex === firstRef.current.sliceIndex) {
				onError("That's the same slice — scroll to a different one first.");
				return;
			}
			setLast({ pane: hit.pane, sliceIndex: hit.sliceIndex });
			setPhase("ready");
		};

		window.addEventListener("pointerdown", onClick, true);
		return () => window.removeEventListener("pointerdown", onClick, true);
	}, [phase, segmentIndex, lastRequiresSegment, onError]);

	const startPicking = () => {
		setPhase("picking");
		setStep(first ? "last" : "first");
	};
	const cancelPicking = () => setPhase(first && last ? "ready" : "idle");

	const reset = () => {
		setFirst(null);
		setLast(null);
		setStep("first");
		setPhase("idle");
	};

	return {
		phase, // "idle" | "picking" | "ready"
		step, // which click we're waiting for while picking
		first,
		last,
		startPicking,
		cancelPicking,
		reset,
	};
}
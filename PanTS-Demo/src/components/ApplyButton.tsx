import { useState } from "react";

interface ApplyButtonProps {
	onApply: () => void;
	disabled?: boolean;
	label?: string;
	applyingLabel?: string;
	className?: string;
}

/**
 * Standard "Apply" button for segment-effect panels (Margin, Islands, Smoothing,
 * Logical operators, Fill between slices, Grow from seeds...).
 *
 * These operations run synchronously on the main thread and, depending on scope/
 * volume size, can take a visible moment — without any feedback that looks exactly
 * like the click did nothing (or that the app froze). This wraps the click handler
 * so the "Applying…" spinner state gets a chance to actually paint (via a double
 * requestAnimationFrame) BEFORE the heavy synchronous work runs and blocks the
 * thread, then clears once it returns.
 */
export default function ApplyButton({
	onApply,
	disabled,
	label = "Apply",
	applyingLabel = "Applying…",
	className = "",
}: ApplyButtonProps) {
	const [applying, setApplying] = useState(false);

	const handleClick = () => {
		if (disabled || applying) return;
		setApplying(true);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				try {
					onApply();
				} finally {
					setApplying(false);
				}
			});
		});
	};

	return (
		<button
			type="button"
			className={`seg-effect__apply ${className}`}
			disabled={disabled || applying}
			onClick={handleClick}
		>
			{applying ? (
				<span className="seg-effect__apply-spinner-wrap">
					<span className="seg-effect__apply-spinner" aria-hidden="true" />
					{applyingLabel}
				</span>
			) : (
				label
			)}
		</button>
	);
}
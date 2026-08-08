import viewerImage from "../assets/viewer.png";

type ViewerShellProps = {
	dimmed: boolean;
};

export default function ViewerShell({ dimmed }: ViewerShellProps) {
	return (
		<div className={`viewer-shell ${dimmed ? "viewer-shell--dimmed" : ""}`}>
			<img
				src={viewerImage}
				alt=""
				className="viewer-shell__image"
			/>

			<div className="viewer-shell__vignette" />
			<div className="viewer-shell__depth-glow" />

			<div className="viewer-report-target" aria-hidden="true">
				<svg viewBox="0 0 24 24">
					<path d="M7 3.5h7l3 3V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
					<path d="M14 3.5V7h3" />
					<path d="M9 11h6M9 14h6M9 17h4" />
				</svg>
			</div>
		</div>
	);
}

import { motion } from "framer-motion";

type CinematicCursorProps = {
	onClickReport: () => void;
};

export default function CinematicCursor({
	onClickReport,
}: CinematicCursorProps) {
	return (
		<motion.button
			type="button"
			className="cinematic-cursor"
			aria-label="Open report"
			initial={{
				x: "68vw",
				y: "72vh",
				opacity: 0,
				scale: 1.4,
				rotate: -8,
			}}
			animate={{
				x: "76.8vw",
				y: "4.5vh",
				opacity: 1,
				scale: 1,
				rotate: 0,
			}}
			transition={{
				x: {
					duration: 2.4,
					ease: [0.16, 1, 0.3, 1],
				},
				y: {
					duration: 2.4,
					ease: [0.16, 1, 0.3, 1],
				},
				opacity: {
					duration: 0.45,
				},
				scale: {
					duration: 1.4,
					ease: [0.16, 1, 0.3, 1],
				},
			}}
			whileHover={{
				scale: 1.05,
			}}
			whileTap={{
				scale: 0.78,
			}}
			onAnimationComplete={() => {
				window.setTimeout(onClickReport, 450);
			}}
		>
			<svg viewBox="0 0 64 64" aria-hidden="true">
				<path d="M11 7 48 35l-17 3 10 18-9 5-10-19-11 13Z" />
			</svg>

			<span className="cursor-ripple" />
		</motion.button>
	);
}

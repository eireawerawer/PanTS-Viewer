import { organDescriptions } from "../../helpers/organInfo";

const pretty = (s: string) => s.replaceAll("_", " ");
const fmtVolume = (cm3: number) => (cm3 >= 1000 ? `${(cm3 / 1000).toFixed(1)} L` : `${Math.round(cm3)} cm³`);

type ReadoutStat = { organ_name: string; volume_cm3: number; mean_hu: number };

type Props = {
	stats: ReadoutStat[] | null;
	loading: boolean;
	error: boolean;
	onLoad: () => void;
};

export default function ScanReadout({ stats, loading, error, onLoad }: Props) {
	return (
		<div className="w-full flex flex-col gap-2 border-2 rounded-sm bg-gray-900 shadow-md">
			<div className="bg-gray-600 w-full h-8 flex items-center justify-center text-center rounded-t-sm text-white">
				Scan readout
			</div>
			<div className="pb-2 pl-4 pr-4 flex flex-col gap-2 max-h-80 overflow-y-auto">
				{loading ? (
					<p className="text-gray-300 text-sm">Reading the scan…</p>
				) : error ? (
					<p className="text-red-400 text-sm">Couldn't load measurements for this scan.</p>
				) : !stats ? (
					<>
						<p className="text-gray-300 text-sm leading-snug">
							A plain-language summary of this scan: each structure's measured size and density, explained. For learning, not diagnosis.
						</p>
						<button
							type="button"
							className="text-white relative !p-1 text-2xs !bg-gray-700 hover:!border-white"
							onClick={onLoad}
						>
							Explain this scan
						</button>
					</>
				) : stats.length === 0 ? (
					<p className="text-gray-300 text-sm">No measurable structures found in this scan.</p>
				) : (
					<>
						<p className="text-gray-400 text-2xs leading-snug">
							Density is in Hounsfield Units (HU): water is 0, fat is negative, soft tissue is mildly positive, bone is high. Volumes are measured from the segmentation. For learning, not diagnosis.
						</p>
						{stats.map((s) => (
							<div key={s.organ_name} className="border-t border-gray-700 pt-2">
								<div className="text-white text-sm capitalize">
									{pretty(s.organ_name)}
									<span className="text-gray-400"> — {fmtVolume(s.volume_cm3)} · {Math.round(s.mean_hu)} HU</span>
								</div>
								<p className="text-gray-300 text-xs leading-snug">
									{organDescriptions[s.organ_name] ?? "A structure identified in this scan."}
								</p>
							</div>
						))}
					</>
				)}
			</div>
		</div>
	);
}

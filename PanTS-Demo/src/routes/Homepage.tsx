import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import About from "../components/About";
import Header from "../components/Header";
import Preview from "../components/Preview";
import { API_BASE } from "../helpers/constants";
import type { PreviewType } from "../types";

const PREVIEW_IDS = [1, 17, 30, 35, 121];

export default function Homepage() {
	const [previewMetadata, setPreviewMetadata] = useState<{
		[key: string]: PreviewType;
	}>({});

	const navigate = useNavigate();

	const aboutRef = useRef<HTMLDivElement>(null);

	const params = useParams<{ page: string; type: string }>();
	const type = params.type || "train";

	useEffect(() => {
		const fetchFiles = async () => {
			try {
				const res = await fetch(
					`${API_BASE}/api/get_preview/${PREVIEW_IDS.join(",")}`
				);
				const data = await res.json();
				for (const key in data) {
					data[key]["age"] = Number(data[key]["age"]);
					setPreviewMetadata((prev) => {
						return {
							...prev,
							[key]: data[key],
						};
					});
				}
			} catch (e) {
				console.error(e);
			}
		};
		fetchFiles();
	}, []);

	const handleAboutClick = () => {
		aboutRef.current?.scrollIntoView({ behavior: "smooth" });
	};

	if (type.toLowerCase() !== "test" && type?.toLowerCase() !== "train")
		return null;

	return (
		<div className="flex gap-4 flex-col text-white relative min-h-screen">
			<Header handleAboutClick={handleAboutClick} />
			<div className="flex flex-col gap-4 p-4 justify-center items-center w-screen">
				<div className="text-2xl font-bold">Previews</div>
				<hr className="w-full" />
				<div className="flex gap-y-4 gap-x-8 p-4 flex-wrap justify-center items-center w-full">
					{PREVIEW_IDS.map((el, idx) => {
						return (
							<Preview
								key={idx.toString()}
								id={el}
								previewMetadata={previewMetadata[el]}
							></Preview>
						);
					})}
				</div>
				<button className="w-1/6 !bg-blue-500 rounded p-2 hover:!bg-blue-600" onClick={() => navigate("/data")}>View all cases</button>
			</div>
			<hr className="w-full" />
			<About aboutRef={aboutRef} />
		</div>
	);
}

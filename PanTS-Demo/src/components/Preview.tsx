import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../helpers/constants";
import type { PreviewType } from "../types";

type Props = {
	id: number;
	previewMetadata: PreviewType;
};
export default function Preview({ id, previewMetadata }: Props) {
	const navigate = useNavigate();
	
	// ! if image not preloaded in public folder

	const [thumbnail, setThumbnail] = useState<string>("");
	useEffect(() => {
		const getPreview = async () => {
			try {
			const res = await fetch(`${API_BASE}/api/get_image_preview/${id}`);
				if (!res.ok) {
					throw new Error(
						`Failed to fetch preview: ${res.status} ${res.statusText}`
					);
				}
				const data = await res.blob();
				const url = URL.createObjectURL(data);
				setThumbnail(url);
			} catch (e) {
				console.error(e);
			}
		};
		getPreview();
	}, [id]);

	if (!previewMetadata) return null;

	return (
		<div className="flex flex-col gap-2 shadow-md p-4 rounded bg-blue-950">
			<div className="flex flex-col gap-1">
				<div className="w-[400px] h-[300px] relative">

				<img src={`/case_${id}_slice.png`} alt="Preview" className="w-full h-full object-cover absolute top-0 left-0 opacity-95"/>
				{/* <img src={thumbnail} alt="Preview" className="w-full h-full object-cover absolute top-0 left-0 opacity-50"/> */}
				</div>
				<p className="font-bold text-lg">Case {id}</p>
				<div>Age: {previewMetadata.age || "-"}</div>
				<div>Sex: {previewMetadata.sex || "-"}</div>
			</div>
			<button onClick={() => navigate(`/case/${id}`)} className="w-full">View Case</button>
		</div>
	);
}

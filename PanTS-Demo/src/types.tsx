import type { RenderingEngine } from "@cornerstonejs/core";
import type { IImageVolume } from "@cornerstonejs/core/dist/types/types";
import type { SetStateAction } from "react";

export type metadataType = {
	"PanTS ID": string;
	shape: [number, number, number];
	spacing: [number, number, number];
	age: string;
	sex: string;
	manufacturer: string;
	"manufacturer model": string;
	"study type": string;
	site: string;
	"site detail": string;
	"site nationality": string;
	"study year": string;
	tumor: 0 | 1;
};

export type DataType = "test" | "train";

export type fileData = {
	type: DataType;
	id: string;
	metadata: metadataType;
};

export type VisualizationRenderReturnType = {
	segRepUIDs: string[];
	renderingEngine: RenderingEngine;
	viewportIds: string[];
	volumeId: string;
	segmentationVolumeArray: IImageVolume;
}

export type CheckBoxData = {
	label: string;
	id: number;
}

export type FileContextType = {
	files: fileData[];
	setFiles: React.Dispatch<SetStateAction<fileData[]>>;
};

export type PreviewType = {
	sex: string;
	age: number;
}

export type Interactions = "Bounding Box" | "Scribble" | "Point" | "";

export type AnnotationContextType = {
	annotationType: Interactions;
	annotationColor: string;
	segmentationType: SegmentationCategories[];
	segmentationOpacity: number;
	setSegmentationOpacity: React.Dispatch<SetStateAction<number>>;
	setAnnotationType: React.Dispatch<SetStateAction<Interactions>>;
	setAnnotationColor: React.Dispatch<SetStateAction<string>>;
	setSegmentationType: React.Dispatch<SetStateAction<SegmentationCategories[]>>;
};

export type Point = [number, number];

export type Shape = {
	type: Interactions;
	points: Point[];
};

export type Coords = {
	pixel: [number, number, number];
	world: [number, number, number];
};

export type SegmentationAnnotations = {
	[key in SegmentationCategories]?: string[];
};

export type SegmentationCategories =
	| "adrenal_gland_left"
	| "adrenal_gland_right"
	| "aorta"
	| "bladder"
	| "celiac_artery"
	| "colon"
	| "common_bile_duct"
	| "duodenum"
	| "femur_left"
	| "femur_right"
	| "gall_bladder"
	| "kidney_left"
	| "kidney_right"
	| "liver"
	| "lung_left"
	| "lung_right"
	| "pancreas_body"
	| "pancreas_head"
	| "pancreas_tail"
	| "pancreas"
	| "pancreatic_duct"
	| "pancreatic_lesion"
	| "postcava"
	| "prostate"
	| "spleen"
	| "stomach"
	| "superior_mesenteric_artery"
	| "veins";

export type LabelRequest = {
	name: SegmentationCategories;
	data: Blob;
};

export type cornerstoneCustomColorLUTType = {
	[key: number]: number[];
};

export type APP_CONSTANTS_TYPE = {
	DEFAULT_SEGMENTATION_OPACITY: number;
	API_ORIGIN: string;
	cornerstoneCustomColorLUT: cornerstoneCustomColorLUTType;
	NVCmapAlpha: number;
	NVColormap: ColorMap
};

export type ColorMap = {	
		R: number[];
		G: number[];
		B: number[];
		I: number[];
}

export type NColorMap = ColorMap & {
	A: number[]
}

export type Axes = "axial" | "sagittal" | "coronal";

export type LastClicked = {
	orientation: Axes;
	x: number;
	y: number;
}
import type { Color } from "@cornerstonejs/core/types";
import type {
	APP_CONSTANTS_TYPE,
	cornerstoneCustomColorLUTType, MiscColorMapType,
	OrganSystemsType,
	SegmentationCategories,
	SubSystems,
	Systems
} from "../types";
import viewerLabelsJson from "./viewerLabels.json";

const configuredApiBase = String(import.meta.env.VITE_API_BASE || "").trim();
const hasWindow = typeof window !== "undefined";
const browserHost = hasWindow ? window.location.hostname : "";
const isBrowserLocalhost = browserHost === "localhost" || browserHost === "127.0.0.1";
const apiBaseLooksLocalhost = /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configuredApiBase);

export const API_BASE = configuredApiBase
	? (apiBaseLooksLocalhost && !isBrowserLocalhost ? "" : configuredApiBase.replace(/\/$/, ""))
	: "";
// export const API_BASE = "http://localhost:5001";

// old
// const x = {
//   1:  [229, 68, 68, 128],
//   2:  [229, 117, 68, 128],
//   3:  [229, 165, 68, 128],
//   5:  [229, 213, 68, 128],
//   6:  [197, 229, 68, 128],
//   7:  [149, 229, 68, 128],
//   8:  [100, 229, 68, 128],
//   11: [68, 229, 84, 128],
//   12: [65, 105, 225, 255], // Kidney (royal blue)
//   13: [30, 144, 255, 255], // Kidney (dodger blue)
//   14: [68, 229, 229, 128],
//   15: [173, 216, 230, 255], // Lung (light blue)
//   16: [135, 206, 235, 255], // Lung (sky blue)
//   17: [68, 84, 229, 128],
//   18: [100, 68, 229, 128],
//   19: [149, 68, 229, 128],
//   20: [197, 68, 229, 128],
//   21: [229, 68, 213, 128],
//   23: [229, 68, 165, 128],
//   25: [229, 68, 117, 128],
//   26: [229, 117, 68, 128],
//   27: [229, 68, 68, 128],
//   28: [229, 213, 68, 128]
//55

export const segmentation_category_colors: { [key: number]: Color } = {
	1: [255, 140, 0, 254], // Dark orange
	2: [255, 165, 0, 254], // Orange
	3: [255, 0, 0, 254], // Artery (red)
	4: [0, 191, 255, 254], // Urinary system (sky blue)
	5: [220, 20, 60, 254], // Artery (crimson red)
	6: [255, 160, 255, 254], // Digestive (salmon)
	7: [34, 139, 34, 254], // Green (bile duct)
	8: [255, 127, 80, 254], // Coral (GI tract)
	9: [245, 245, 245, 254], // Bone (light gray)
	10: [220, 220, 220, 254], // Bone (gray)
	11: [0, 128, 0, 254], // Dark green
	12: [68, 229, 133, 254],
	13: [68, 229, 181, 254],
	14: [178, 34, 34, 254], // Liver (brownish red)
	15: [68, 181, 229, 254],
	16: [68, 133, 229, 254],
	17: [255, 182, 193, 254], // Pancreas (light pink)
	18: [255, 105, 180, 254], // Pancreas (hot pink)
	19: [219, 112, 147, 254], // Pancreas (pale violet red)
	20: [255, 160, 122, 254], // Pancreas general (salmon)
	21: [255, 228, 181, 254], // Light tan (duct)
	22: [80, 0, 0, 254], // Dark red (lesion)
	23: [72, 61, 139, 254], // Vein (dark slate blue)
	24: [255, 105, 180, 254], // Magenta/pink
	25: [138, 43, 226, 254], // Purple
	26: [255, 99, 71, 254], // Tomato red
	27: [255, 69, 0, 254], // Bright red-orange artery
	28: [106, 90, 205, 254], // Medium slate blue
	29: [255, 200, 120, 254], // Intestine (warm yellow-orange)
	30: [100, 149, 237, 254], // Renal vein left (cornflower blue)
	31: [70, 130, 180, 254],  // Renal vein right (steel blue)
	32: [192, 192, 192, 254], // CBD stent (silver-gray)
	33: [255, 140, 0, 254],   // Liver lesion (dark orange)
	34: [255, 215, 0, 254],   // Kidney lesion (gold)
	35: [220, 20, 60, 254],   // Colon lesion (crimson)

	// 36+: organs the media-agentic-ai teacher models (cads55x/moose*/airrc/atm/lvp/daps,
	// see EXTENDED_ORGAN_NAMES below)
	36: [217, 65, 65, 254],    // Heart atrium left
	37: [217, 42, 11, 254],    // Heart atrium right
	38: [178, 91, 54, 254],    // Heart ventricle left
	39: [217, 115, 33, 254],   // Heart ventricle right
	40: [217, 156, 65, 254],   // Heart myocardium
	41: [242, 191, 36, 254],   // Heart (generic single-label)
	42: [11, 155, 217, 254],   // Pulmonary artery
	43: [27, 110, 178, 254],   // Pulmonary vein
	44: [178, 90, 9, 254],     // Esophagus
	45: [178, 145, 89, 254],   // Trachea
	46: [152, 87, 217, 254],   // Brain
	47: [11, 93, 217, 254],    // Iliac artery left
	48: [9, 51, 178, 254],     // Iliac artery right
	49: [33, 51, 217, 254],    // Iliac vein left
	50: [11, 0, 217, 254],     // Iliac vein right
	51: [128, 104, 19, 254],   // Vertebrae, cervical (C1-C7)
	52: [255, 240, 38, 254],   // Humerus left
	53: [233, 242, 121, 254],  // Humerus right
	54: [167, 217, 0, 254],    // Scapula left
	55: [159, 217, 65, 254],   // Scapula right
	56: [119, 217, 33, 254],   // Clavicle left
	57: [77, 217, 11, 254],    // Clavicle right
	58: [109, 217, 87, 254],   // Hip left
	59: [36, 217, 33, 254],    // Hip right
	60: [121, 242, 137, 254],  // Sacrum
	61: [0, 242, 10, 254],     // Muscle (generic)
	62: [33, 217, 84, 254],    // Rib left (all 12 collapse to one class)
	63: [0, 242, 104, 254],    // Rib right (all 12 collapse to one class)
	64: [27, 178, 56, 254],    // Spinal cord
	65: [202, 217, 33, 254],   // Larynx
	66: [178, 145, 27, 254],   // Sigmoid
	67: [217, 208, 87, 254],   // Rectum
	68: [54, 178, 96, 254],    // Seminal vesicle
	69: [89, 178, 133, 254],   // Mammary gland left
	70: [9, 178, 117, 254],    // Mammary gland right
	71: [19, 128, 105, 254],   // Sternum
	72: [191, 97, 242, 254],   // White matter
	73: [176, 11, 217, 254],   // Gray matter
	74: [232, 36, 242, 254],   // CSF
	75: [97, 242, 234, 254],   // Scalp
	76: [217, 33, 198, 254],   // Eyeball (generic)
	77: [121, 242, 191, 254],  // Skull
	78: [11, 217, 161, 254],   // Mandible
	79: [242, 73, 215, 254],   // Parotid gland left
	80: [217, 11, 153, 254],   // Parotid gland right
	81: [217, 65, 147, 254],   // Cochlea left
	82: [217, 33, 104, 254],   // Cochlea right
	83: [178, 71, 97, 254],    // Optic nerve left
	84: [153, 0, 14, 254],     // Optic nerve right
	85: [128, 44, 38, 254],    // Thyroid
	86: [0, 139, 153, 254],    // Fat
	87: [36, 242, 218, 254],   // Bone (generic)
	88: [27, 178, 178, 254],   // Airway
	89: [140, 153, 61, 254],   // Vertebrae, thoracic (T1-T12)
	90: [124, 178, 9, 254],    // Vertebrae, lumbar (L1-L5)
};

// which ids count as "static" (dataset case viewer,
// always shown) vs. "extended" (upload/inference session viewer only)
const STATIC_ORGAN_COUNT = 35;

const VIEWER_LABEL_ENTRIES: [number, string][] = Object.entries(
	viewerLabelsJson as Record<string, string>
)
	.map(([id, name]) => [Number(id), name] as [number, string])
	.sort((a, b) => a[0] - b[0]);

// Organs beyond the static 35-class scheme.
export const EXTENDED_ORGAN_NAMES: { [key: number]: string } = Object.fromEntries(
	VIEWER_LABEL_ENTRIES.filter(([id]) => id > STATIC_ORGAN_COUNT)
);

// Rotating palette of colours to hand out to new classes.
// No colour clash with existing organ palette above.
// Kept seperate from segmentation_category_colors, as these are assigned dynamically, not per-organ.
export const NEW_CLASS_PALETTE: Color[] = [
	[255, 99, 132, 255],  // pink
	[54, 162, 235, 255],  // blue
	[255, 206, 86, 255],  // yellow
	[75, 192, 192, 255],  // teal
	[153, 102, 255, 255], // purple
	[255, 159, 64, 255],  // orange
	[46, 204, 113, 255],  // green
	[231, 76, 60, 255],   // red
  ];

export const segmentation_categories: SegmentationCategories[] = VIEWER_LABEL_ENTRIES
	.filter(([id]) => id <= STATIC_ORGAN_COUNT)
	.map(([, name]) => name as SegmentationCategories);

export const OrganSystemsArray: Systems[] = [
	"Vascular System",
	"Digestive System",
	"Endocrine System",
	"Urinary System",
	"Skeletal System",
	"Lymphatic System",
	"Reproductive System",
	"Respiratory System"
	// "Adrenal Glands",
	// "Pancreas",
	// "Kidneys",
	// "Femur",
	// "Lung",
	// "Other"
];

export const OrgansSubsystemsArray: SubSystems[] = [
	"Kidneys",
	"Pancreas"
]

export const MiscColorMap: MiscColorMapType = {
	"Kidneys": [144, 238, 200],
	"Pancreas": [244, 160, 160]
}

export const OrganSystems: OrganSystemsType = {
	"Vascular System": [
		"aorta",
		"celiac_artery",
		"superior_mesenteric_artery",
		"postcava",
		"veins",
		"renal_vein_left",
		"renal_vein_right",
	],
	"Endocrine System": ["adrenal_gland_left", "adrenal_gland_right"],
	"Urinary System": [{ Kidneys: ["kidney_left", "kidney_right", "kidney_lesion"] }, "bladder"],
	// bladder
	"Skeletal System": ["femur_left", "femur_right"],

	"Digestive System": [
		{
			Pancreas: [
				"pancreas",
				"pancreas_body",
				"pancreas_head",
				"pancreas_tail",
				"pancreatic_duct",
				"pancreatic_lesion",
			],
		},
		"colon",
		"colon_lesion",
		"duodenum",
		"intestine",
		"stomach",
		"liver",
		"liver_lesion",
		"common_bile_duct",
		"gall_bladder",
		"cbd_stent",
	],
	"Respiratory System": ["lung_left", "lung_right"],
	"Reproductive System": ["prostate"],
	"Lymphatic System": ["spleen"],
};

const RED = [230, 25, 75, 255];
const BLUE = [0, 130, 200, 255];
const MAROON = [128, 0, 0, 255];
const BROWN = [170, 110, 40, 255];
const OLIVE = [128, 128, 0, 255];
//const OLIVE = [0, 0, 0, 0];
const TEAL = [0, 128, 128, 255];
const PURPLE = [145, 30, 180, 255];
const MAGENTA = [240, 50, 230, 255];
const LIME = [50, 205, 50, 255];

const cornerstoneCustomColorLUT: cornerstoneCustomColorLUTType = {
	0: [0, 0, 0, 0], // transparent for background
	1: RED,
	2: BLUE,
	3: MAROON,
	4: BROWN,
	5: OLIVE,
	6: TEAL,
	7: PURPLE,
	8: MAGENTA,
	9: LIME,
	// Add more mappings as needed
};
const NVCmapAlpha = 128;

function createNVColorMapFromCornerstoneLUT() {
	const R: number[] = [];
	const G: number[] = [];
	const B: number[] = [];
	const A: number[] = [];
	const I: number[] = [];
	Object.keys(cornerstoneCustomColorLUT).forEach((intensity) => {
		I.push(Number(intensity));
		const RGBA = cornerstoneCustomColorLUT[Number(intensity)];
		R.push(RGBA[0]);
		G.push(RGBA[1]);
		B.push(RGBA[2]);
		if (intensity === "0") {
			A.push(0);
		} else {
			A.push(NVCmapAlpha);
		}
	});

	const cmap = {
		R: R,
		G: G,
		B: B,
		A: A,
		I: I,
	};
	return cmap;
}

export const APP_CONSTANTS: APP_CONSTANTS_TYPE = {
	DEFAULT_SEGMENTATION_OPACITY: 0.6,
	API_ORIGIN: API_BASE,
	cornerstoneCustomColorLUT: cornerstoneCustomColorLUT,
	NVCmapAlpha: NVCmapAlpha,
	NVColormap: createNVColorMapFromCornerstoneLUT(),
};

export const ITEMS_PER_DATA_PAGE = 50;

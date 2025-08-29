import type { APP_CONSTANTS_TYPE, cornerstoneCustomColorLUTType, SegmentationCategories } from "../types";

export const API_BASE = import.meta.env.VITE_API_BASE

export const segmentation_categories: SegmentationCategories[] = [
    "adrenal_gland_left",
    "adrenal_gland_right",
    "aorta",
    "bladder",
    "celiac_artery",
    "colon",
    "common_bile_duct",
    "duodenum",
    "femur_left",
    "femur_right",
    "gall_bladder",
    "kidney_left",
    "kidney_right",
    "liver",
    "lung_left",
    "lung_right",
    "pancreas_body",
    "pancreas_head",
    "pancreas_tail",
    "pancreas",
    "pancreatic_duct",
    "pancreatic_lesion",
    "postcava",
    "prostate",
    "spleen",
    "stomach",
    "superior_mesenteric_artery",
    "veins"
]


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
    0: [0, 0, 0, 0],       // transparent for background
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

function createNVColorMapFromCornerstoneLUT(){
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
        if (intensity === '0') {
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
        I: I
    }
    return cmap;
}

export const APP_CONSTANTS: APP_CONSTANTS_TYPE = {
    DEFAULT_SEGMENTATION_OPACITY: 0.60,
    API_ORIGIN: API_BASE,
    cornerstoneCustomColorLUT: cornerstoneCustomColorLUT,
    NVCmapAlpha: NVCmapAlpha,
    NVColormap: createNVColorMapFromCornerstoneLUT()
};

export const ITEMS_PER_DATA_PAGE = 50;
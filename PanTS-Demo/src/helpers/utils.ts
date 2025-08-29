import JSZip from "jszip";

export const cleanName = (case_id: string) => {
    let new_id = case_id;
    new_id = new_id.replace("PanTS_", "");
    while (new_id[0] === "0") {
        new_id = new_id.substring(1);
    }
    return new_id
}

export function filenameToName(filename: string): string {
    const index = filename.indexOf('.');
    if (index === -1) {
        return filename;
    }

    return filename.substring(0, index);
}

export function arrayIsEqual<T>(arr1: T[], arr2: T[]): boolean {
    if (arr1.length !== arr2.length) {
        return false;
    }
    for (let i = 0; i < arr1.length; i++){
        if (arr1[i] !== arr2[i]){
            return false;
        }
    }
    return true;
}

export const getPanTSId = (case_id: string) => {
    let new_id = case_id;
    const iter = 8 - new_id.toString().length;
    for (let i = 0; i < Math.max(0, iter); i++) {
        new_id = "0" + new_id;
    }
    return `PanTS_${new_id}`;
}

export function capitalize(word: string) {
	if (!word) return "";
	return word.charAt(0).toUpperCase() + word.slice(1);
}

export function roundDigits(x: number, digits: number) {
	return parseFloat(x.toFixed(digits));
}

export async function zipToURL(data: Blob) {

    const zip = await JSZip.loadAsync(data);
    const sliceImages = [];

    for (const fileName of Object.keys(zip.files)) {
        const fileData = await zip.files[fileName].async("blob");
        const url = URL.createObjectURL(fileData);
        sliceImages.push({ name: fileName, url });
    }

    // Sort slices by filename so they are in order
    sliceImages.sort((a, b) => a.name.localeCompare(b.name));
    const urlSlices = sliceImages.map((el) => el.url);
    return urlSlices
}

export function prettify_segmentation_category(txt: string) {
    const arr = txt.split("_").map((el) => capitalize(el));
    return arr.join(" ");
}

import { describe, expect, it } from "vitest";
import { ctVolumeIdForUrl } from "./CornerstoneNifti2";

describe("ctVolumeIdForUrl", () => {
	it("keeps each in-app quiz case in a distinct Cornerstone cache entry", () => {
		const case35 = "http://localhost:5001/api/get-main-nifti/35.nii.gz?res=low";
		const case145 = "http://localhost:5001/api/get-main-nifti/145.nii.gz?res=low";

		expect(ctVolumeIdForUrl(case35)).toBe(`myVolume:${case35}`);
		expect(ctVolumeIdForUrl(case145)).not.toBe(ctVolumeIdForUrl(case35));
	});

	it("reuses the cache entry when only the reveal overlay changes", () => {
		const ctUrl = "http://localhost:5001/api/get-main-nifti/35.nii.gz?res=low";

		expect(ctVolumeIdForUrl(ctUrl)).toBe(ctVolumeIdForUrl(ctUrl));
	});
});

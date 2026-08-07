// Guards viewerLabels.json (the frontend/backend shared organ id<->name source of
// truth -- flask-server/services/viewer_labels.py loads this exact file) against
// drifting from the two things that still have to be hand-authored on this side:
// segmentation_category_colors (a visual/design choice with no backend equivalent)
// and STATIC_ORGAN_COUNT (the dataset-viewer/inference-viewer split, a policy
// decision, not something derivable from the data). See constants.ts's comments
// above EXTENDED_ORGAN_NAMES and segmentation_categories for the full picture, and
// flask-server/tests/unit/test_viewer_labels.py for the backend-side half of this.
import { describe, expect, it } from "vitest";
import {
	EXTENDED_ORGAN_NAMES,
	segmentation_categories,
	segmentation_category_colors,
} from "./constants";
import viewerLabelsJson from "./viewerLabels.json";

const allIds = Object.keys(viewerLabelsJson).map(Number).sort((a, b) => a - b);

describe("viewerLabels.json consistency", () => {
	it("has contiguous ids starting at 1 (segmentation_categories assumes id = array index + 1)", () => {
		expect(allIds).toEqual(Array.from({ length: allIds.length }, (_, i) => i + 1));
	});

	it("has no duplicate organ names", () => {
		const names = Object.values(viewerLabelsJson);
		const dupes = names.filter((n, i) => names.indexOf(n) !== i);
		expect(dupes).toEqual([]);
	});

	it("segmentation_categories + EXTENDED_ORGAN_NAMES together account for every id, with none left over or duplicated", () => {
		const staticIds = segmentation_categories.map((_, i) => i + 1);
		const extendedIds = Object.keys(EXTENDED_ORGAN_NAMES).map(Number);
		const reconstructed = [...staticIds, ...extendedIds].sort((a, b) => a - b);
		expect(reconstructed).toEqual(allIds);
	});

	it("every organ id has a color (segmentation_category_colors doesn't come from viewerLabels.json -- it's hand-authored, so it's the one place a new organ can silently end up uncolored)", () => {
		const missing = allIds.filter((id) => !segmentation_category_colors[id]);
		expect(missing).toEqual([]);
	});

	it("has no stray colors for ids that don't exist in viewerLabels.json", () => {
		const idSet = new Set(allIds);
		const stray = Object.keys(segmentation_category_colors)
			.map(Number)
			.filter((id) => !idSet.has(id));
		expect(stray).toEqual([]);
	});
});

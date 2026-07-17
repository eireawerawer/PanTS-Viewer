import { beforeEach, describe, expect, it } from "vitest";
import { isSavedCase, loadSavedCases, SAVED_CASES_KEY, toggleSavedCase } from "./savedCases";

const meta = (id: string) => ({ id, sex: "M", age: 50, tumor: 0 });

describe("savedCases", () => {
	beforeEach(() => localStorage.clear());

	it("starts empty", () => {
		expect(loadSavedCases()).toEqual([]);
		expect(isSavedCase("17")).toBe(false);
	});

	it("toggles a case on and off", () => {
		toggleSavedCase(meta("17"));
		expect(isSavedCase("17")).toBe(true);
		expect(loadSavedCases().map((c) => c.id)).toEqual(["17"]);

		toggleSavedCase(meta("17"));
		expect(isSavedCase("17")).toBe(false);
		expect(loadSavedCases()).toEqual([]);
	});

	it("stores the card metadata and a savedAt timestamp", () => {
		const before = Date.now();
		toggleSavedCase({ id: "30", sex: "F", age: 66, tumor: 1 });
		const [saved] = loadSavedCases();
		expect(saved).toMatchObject({ id: "30", sex: "F", age: 66, tumor: 1 });
		expect(saved.savedAt).toBeGreaterThanOrEqual(before);
	});

	it("keeps most-recently-saved first and de-dupes by id", () => {
		toggleSavedCase(meta("1"));
		toggleSavedCase(meta("2"));
		expect(loadSavedCases().map((c) => c.id)).toEqual(["2", "1"]);
		// re-adding an already-saved id removes it (toggle), it does not duplicate
		toggleSavedCase(meta("2"));
		expect(loadSavedCases().map((c) => c.id)).toEqual(["1"]);
	});

	it("works with a CancerVerse id, unchanged behavior", () => {
		toggleSavedCase(meta("CV_00000012"));
		expect(isSavedCase("CV_00000012")).toBe(true);
		expect(loadSavedCases().map((c) => c.id)).toEqual(["CV_00000012"]);
	});

	it("ignores corrupt storage instead of throwing", () => {
		localStorage.setItem(SAVED_CASES_KEY, "not json");
		expect(loadSavedCases()).toEqual([]);
		localStorage.setItem(SAVED_CASES_KEY, JSON.stringify([{ nope: true }, { id: 5, sex: "M", age: 1, tumor: 0, savedAt: 1 }]));
		expect(loadSavedCases().map((c) => c.id)).toEqual(["5"]);
	});

	it("coerces legacy numeric ids (saved before ids became strings) to strings", () => {
		localStorage.setItem(
			SAVED_CASES_KEY,
			JSON.stringify([{ id: 17, sex: "M", age: 40, tumor: 0, savedAt: 1 }])
		);
		expect(loadSavedCases().map((c) => c.id)).toEqual(["17"]);
		expect(isSavedCase("17")).toBe(true);
	});
});

import { beforeEach, describe, expect, it } from "vitest";
import {
	addRecentUpload,
	formatRelativeTime,
	loadRecentUploads,
	MAX_RECENT_UPLOADS,
	RECENT_WINDOW_MS,
	recentStatusColor,
	splitByAge,
	groupUploads,
	updateRecentUploadStatus,
	type RecentUpload,
} from "./recentUploads";

const makeEntry = (overrides: Partial<RecentUpload> = {}): RecentUpload => ({
	sessionId: "s1",
	label: "ct.nii.gz",
	model: "SuPreM",
	status: "Processing",
	timestamp: Date.now(),
	...overrides,
});

beforeEach(() => {
	localStorage.clear();
});

describe("loadRecentUploads", () => {
	it("returns an empty array when nothing is stored", () => {
		expect(loadRecentUploads()).toEqual([]);
	});

	it("returns an empty array when storage holds malformed JSON", () => {
		localStorage.setItem("recentUploads", "{not json");
		expect(loadRecentUploads()).toEqual([]);
	});
});

describe("addRecentUpload", () => {
	it("prepends the newest entry", () => {
		addRecentUpload(makeEntry({ sessionId: "a" }));
		const list = addRecentUpload(makeEntry({ sessionId: "b" }));
		expect(list.map((u) => u.sessionId)).toEqual(["b", "a"]);
	});

	it("de-duplicates by sessionId (re-adding moves it to the front)", () => {
		addRecentUpload(makeEntry({ sessionId: "a" }));
		addRecentUpload(makeEntry({ sessionId: "b" }));
		const list = addRecentUpload(makeEntry({ sessionId: "a", label: "updated" }));
		expect(list.map((u) => u.sessionId)).toEqual(["a", "b"]);
		expect(list.filter((u) => u.sessionId === "a")).toHaveLength(1);
		expect(list[0].label).toBe("updated");
	});

	it(`caps the list at ${MAX_RECENT_UPLOADS} entries`, () => {
		for (let i = 0; i < MAX_RECENT_UPLOADS + 4; i++) {
			addRecentUpload(makeEntry({ sessionId: `s${i}` }));
		}
		expect(loadRecentUploads()).toHaveLength(MAX_RECENT_UPLOADS);
	});
});

describe("updateRecentUploadStatus", () => {
	it("updates only the matching session's status", () => {
		addRecentUpload(makeEntry({ sessionId: "a" }));
		addRecentUpload(makeEntry({ sessionId: "b" }));
		const list = updateRecentUploadStatus("a", "Completed");
		expect(list.find((u) => u.sessionId === "a")?.status).toBe("Completed");
		expect(list.find((u) => u.sessionId === "b")?.status).toBe("Processing");
	});
});

describe("formatRelativeTime", () => {
	it("formats recent, minutes, hours, and days", () => {
		const now = Date.now();
		expect(formatRelativeTime(now)).toBe("Just now");
		expect(formatRelativeTime(now - 5 * 60_000)).toBe("5 mins ago");
		expect(formatRelativeTime(now - 1 * 60_000)).toBe("1 min ago");
		expect(formatRelativeTime(now - 3 * 60 * 60_000)).toBe("3 hours ago");
		expect(formatRelativeTime(now - 25 * 60 * 60_000)).toBe("Yesterday");
		expect(formatRelativeTime(now - 4 * 24 * 60 * 60_000)).toBe("4 days ago");
	});
});

describe("recentStatusColor", () => {
	it("maps each status to its color", () => {
		expect(recentStatusColor("Failed")).toBe("#ef4444");
		expect(recentStatusColor("Processing")).toBe("#6a6a6a");
		expect(recentStatusColor("Completed")).toBe("#8f8f8f");
	});
});

describe("splitByAge", () => {
	const now = Date.UTC(2026, 7, 7, 12, 0, 0);
	const agoMs = (ms: number) => now - ms;

	it("keeps the last day on the upload page and sends the rest to history", () => {
		const groups = groupUploads([
			makeEntry({ sessionId: "today", timestamp: agoMs(2 * 60 * 60 * 1000) }),
			makeEntry({ sessionId: "old", timestamp: agoMs(3 * RECENT_WINDOW_MS) }),
		]);

		const { recent, older } = splitByAge(groups, now);
		expect(recent.map((g) => g.timestamp)).toEqual([agoMs(2 * 60 * 60 * 1000)]);
		expect(older.map((g) => g.timestamp)).toEqual([agoMs(3 * RECENT_WINDOW_MS)]);
	});

	it("treats an entry exactly on the boundary as recent", () => {
		const groups = groupUploads([
			makeEntry({ sessionId: "edge", timestamp: agoMs(RECENT_WINDOW_MS) }),
		]);
		expect(splitByAge(groups, now).recent).toHaveLength(1);
	});

	it("judges a batch by its newest scan so it is never torn in half", () => {
		const groups = groupUploads([
			makeEntry({
				sessionId: "a", batchId: "b1", batchLabel: "2 scans",
				timestamp: agoMs(3 * RECENT_WINDOW_MS),
			}),
			makeEntry({
				sessionId: "b", batchId: "b1", batchLabel: "2 scans",
				timestamp: agoMs(60 * 1000),
			}),
		]);

		const { recent, older } = splitByAge(groups, now);
		expect(older).toHaveLength(0);
		expect(recent).toHaveLength(1);
		expect(recent[0].kind === "batch" && recent[0].uploads).toHaveLength(2);
	});

	it("returns both sides empty for an empty list", () => {
		expect(splitByAge([], now)).toEqual({ recent: [], older: [] });
	});
});

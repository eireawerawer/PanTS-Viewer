// Recent uploads persisted in the user's localStorage (mirrors JHU's recentIds
// pattern). Extracted from UploadPage so the logic can be unit-tested.

export type RecentUploadStatus = "Processing" | "Completed" | "Failed" | "Cancelled";

export type RecentUpload = {
	sessionId: string;
	label: string;
	model: string;
	status: RecentUploadStatus;
	timestamp: number;
	isReconstruction?: boolean;
	// Scans run together (multi-select) share a batchId + batchLabel. A scan run
	// on its own has neither and is treated as an individual entry.
	batchId?: string;
	batchLabel?: string;
};

export const RECENT_UPLOADS_KEY = "recentUploads";
// Raised from 8 so a multi-scan batch isn't half-evicted from the list, and
// again from 60 once anything older than a day became the History page's
// content — a history that forgets your 61st scan isn't much of one.
export const MAX_RECENT_UPLOADS = 200;

const TERMINAL: RecentUploadStatus[] = ["Completed", "Failed", "Cancelled"];
export const isTerminalStatus = (s: RecentUploadStatus): boolean => TERMINAL.includes(s);

// A grouped view over the flat upload list: each entry is either a lone scan or
// a batch of scans sharing a batchId. Ordered by most-recent activity.
export type UploadGroup =
	| { kind: "single"; upload: RecentUpload; timestamp: number }
	| {
			kind: "batch";
			batchId: string;
			label: string;
			uploads: RecentUpload[];
			timestamp: number;
	  };

export const groupUploads = (list: RecentUpload[]): UploadGroup[] => {
	const batches = new Map<string, RecentUpload[]>();
	const groups: UploadGroup[] = [];

	for (const u of list) {
		if (u.batchId) {
			if (!batches.has(u.batchId)) batches.set(u.batchId, []);
			batches.get(u.batchId)!.push(u);
		} else {
			groups.push({ kind: "single", upload: u, timestamp: u.timestamp });
		}
	}

	for (const [batchId, uploads] of batches) {
		groups.push({
			kind: "batch",
			batchId,
			label: uploads[0].batchLabel || `${uploads.length} scans`,
			uploads,
			timestamp: Math.max(...uploads.map((u) => u.timestamp)),
		});
	}

	return groups.sort((a, b) => b.timestamp - a.timestamp);
};

// A batch is "in flight" while any of its scans is still processing; it's
// "done" once every scan has reached a terminal state.
export const isGroupInFlight = (g: UploadGroup): boolean =>
	g.kind === "single"
		? g.upload.status === "Processing"
		: g.uploads.some((u) => u.status === "Processing");

// How long a finished scan stays on the Upload page before it belongs to
// history. A day is the window in which you're still working with a result;
// past that the Upload page is showing you a filing cabinet.
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Split finished groups into what the Upload page shows and what History gets.
 *  A batch is judged by its most recent scan, so a batch straddling the
 *  boundary stays whole rather than being torn in half. */
export const splitByAge = (
	groups: UploadGroup[],
	now: number = Date.now()
): { recent: UploadGroup[]; older: UploadGroup[] } => {
	const cutoff = now - RECENT_WINDOW_MS;
	return {
		recent: groups.filter((g) => g.timestamp >= cutoff),
		older: groups.filter((g) => g.timestamp < cutoff),
	};
};

export const loadRecentUploads = (): RecentUpload[] => {
	try {
		const arr = JSON.parse(localStorage.getItem(RECENT_UPLOADS_KEY) || "[]");
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
};

export const persistRecentUploads = (list: RecentUpload[]) => {
	try {
		localStorage.setItem(RECENT_UPLOADS_KEY, JSON.stringify(list.slice(0, MAX_RECENT_UPLOADS)));
	} catch (e) {
		console.warn("saveRecentUploads failed", e);
	}
};

export const addRecentUpload = (entry: RecentUpload): RecentUpload[] => {
	const list = [entry, ...loadRecentUploads().filter((u) => u.sessionId !== entry.sessionId)];
	const trimmed = list.slice(0, MAX_RECENT_UPLOADS);
	persistRecentUploads(trimmed);
	return trimmed;
};

export const removeRecentUpload = (sessionId: string): RecentUpload[] => {
	const list = loadRecentUploads().filter((u) => u.sessionId !== sessionId);
	persistRecentUploads(list);
	return list;
};

export const updateRecentUploadStatus = (
	sessionId: string,
	status: RecentUploadStatus
): RecentUpload[] => {
	const list = loadRecentUploads().map((u) => (u.sessionId === sessionId ? { ...u, status } : u));
	persistRecentUploads(list);
	return list;
};

export const formatRelativeTime = (ts: number): string => {
	const mins = Math.floor((Date.now() - ts) / 60000);
	if (mins < 1) return "Just now";
	if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? "Yesterday" : `${days} days ago`;
};

export const recentStatusColor = (status: RecentUploadStatus): string =>
	status === "Failed"
		? "#ef4444"
		: status === "Cancelled"
			? "#d97706"
			: status === "Processing"
				? "#6a6a6a"
				: "#8f8f8f";

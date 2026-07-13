import { API_BASE } from "../helpers/constants";
import { ungzip } from "pako";
import type { MaskRange } from "../helpers/CornerstoneNifti2";
import type {
	LiveRoomChatMessage,
	LiveRoomDurableState,
	LiveRoomEvent,
	LiveRoomMeasurement,
	LiveRoomMetadata,
	LiveRoomNote,
} from "./types";

export const LIVE_ROOM_PROTOCOL = 1;
export const LIVE_ROOM_FRAME_BYTES = 512 * 1024;
export const MAX_LIVE_ROOM_CHAT_MESSAGES = 500;

export function liveRoomCreatorAutoJoinKey(roomId: string): string {
	return `bodymaps.live-room.${roomId}.creator-auto-join`;
}

export function consumeCreatorAutoJoinName(
	roomId: string,
	storedName: string,
	storage: Storage = window.sessionStorage
): string | null {
	const key = liveRoomCreatorAutoJoinKey(roomId);
	if (!storedName || storage.getItem(key) !== "1") return null;
	storage.removeItem(key);
	return storedName;
}

export function roomKeyFromFragment(fragment = window.location.hash): string {
	const encoded = fragment.replace(/^#/, "").trim();
	try {
		return decodeURIComponent(encoded);
	} catch {
		return "";
	}
}

export function liveRoomWebSocketUrl(roomId: string): string {
	const url = new URL(`/ws/live-rooms/${encodeURIComponent(roomId)}`, window.location.origin);
	url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

export function liveRoomApiUrl(roomId: string, suffix = ""): string {
	return `${API_BASE}/api/live-rooms/${encodeURIComponent(roomId)}${suffix}`;
}

export function emptyDurableState(): LiveRoomDurableState {
	return { measurements: {}, notes: {}, chat: [], undone_event_ids: [] };
}

export function applyCommittedEvent(
	state: LiveRoomDurableState,
	event: LiveRoomEvent
): LiveRoomDurableState {
	const next: LiveRoomDurableState = {
		...state,
		measurements: { ...state.measurements },
		notes: { ...state.notes },
		chat: [...state.chat],
	};
	const payload = event.payload as {
		measurement?: LiveRoomMeasurement;
		note?: LiveRoomNote;
		message?: LiveRoomChatMessage;
		id?: string;
	};
	if (event.type === "measurement.upsert" && payload.measurement?.id) {
		next.measurements[payload.measurement.id] = payload.measurement;
	} else if (event.type === "measurement.delete" && payload.id) {
		delete next.measurements[payload.id];
	} else if (event.type === "note.upsert" && payload.note?.id) {
		next.notes[payload.note.id] = payload.note;
	} else if (event.type === "note.delete" && payload.id) {
		delete next.notes[payload.id];
	} else if (event.type === "chat.add" && payload.message?.id) {
		const message = payload.message;
		if (!next.chat.some((item) => item.id === message.id)) {
			next.chat.push(message);
			if (next.chat.length > MAX_LIVE_ROOM_CHAT_MESSAGES) {
				next.chat = next.chat.slice(-MAX_LIVE_ROOM_CHAT_MESSAGES);
			}
		}
	}
	return next;
}

/** Split at range boundaries, leaving room for envelope JSON below 512 KiB. */
export function chunkMaskRanges(ranges: MaskRange[], targetBytes = 440 * 1024): MaskRange[][] {
	const chunks: MaskRange[][] = [];
	let current: MaskRange[] = [];
	let bytes = 2;
	for (const range of ranges) {
		const rangeBytes = JSON.stringify(range).length + 1;
		if (current.length && bytes + rangeBytes > targetBytes) {
			chunks.push(current);
			current = [];
			bytes = 2;
		}
		current.push(range);
		bytes += rangeBytes;
	}
	if (current.length) chunks.push(current);
	return chunks;
}

export async function bootstrapLiveRoom(roomId: string, roomKey: string): Promise<{
	metadata: LiveRoomMetadata;
	state: LiveRoomDurableState;
	maskUrl: string;
	maskSequence: number;
}> {
	const headers = { "X-Room-Key": roomKey };
	const metadataResponse = await fetch(liveRoomApiUrl(roomId), { headers });
	const metadataBody = await metadataResponse.json().catch(() => ({}));
	if (!metadataResponse.ok) throw new Error(metadataBody.error || `Room lookup failed (${metadataResponse.status})`);

	// Materialize mask first.  WebSocket resumes after this exact sequence so mask
	// edits committed while bootstrap continues arrive as normal events.
	const maskResponse = await fetch(`${liveRoomApiUrl(roomId, "/snapshot")}?format=mask`, { headers });
	if (!maskResponse.ok) {
		const body = await maskResponse.json().catch(() => ({}));
		throw new Error(body.error || `Room mask failed (${maskResponse.status})`);
	}
	const maskSequence = Number(maskResponse.headers.get("X-Live-Room-Sequence") || 0);
	// Cornerstone decides gzip handling from URL suffix. Blob URLs don't end in
	// `.gz`, so expose decompressed NIfTI bytes instead of compressed bytes under a
	// suffix-less blob URL.
	const compressedMask = new Uint8Array(await maskResponse.arrayBuffer());
	const maskUrl = URL.createObjectURL(new Blob([new Uint8Array(ungzip(compressedMask))], {
		type: "application/octet-stream",
	}));

	const snapshotResponse = await fetch(liveRoomApiUrl(roomId, "/snapshot"), { headers });
	const snapshot = await snapshotResponse.json().catch(() => ({}));
	if (!snapshotResponse.ok) {
		URL.revokeObjectURL(maskUrl);
		throw new Error(snapshot.error || `Room snapshot failed (${snapshotResponse.status})`);
	}
	return {
		metadata: metadataBody as LiveRoomMetadata,
		state: (snapshot.state ?? emptyDurableState()) as LiveRoomDurableState,
		maskUrl,
		maskSequence,
	};
}

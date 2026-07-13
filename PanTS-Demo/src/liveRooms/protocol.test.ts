import { describe, expect, it } from "vitest";
import {
	MAX_LIVE_ROOM_CHAT_MESSAGES,
	applyCommittedEvent,
	chunkMaskRanges,
	consumeCreatorAutoJoinName,
	emptyDurableState,
	liveRoomCreatorAutoJoinKey,
	roomKeyFromFragment,
} from "./protocol";
import type { LiveRoomEvent } from "./types";

describe("Live Room protocol helpers", () => {
	it("extracts capability only from URL fragment", () => {
		expect(roomKeyFromFragment("#secret%2Fkey")).toBe("secret/key");
		expect(roomKeyFromFragment("#%zz")).toBe("");
	});

	it("chunks mask ranges without losing order", () => {
		const ranges = Array.from({ length: 40 }, (_, index) => ({ start: index, length: 1, before: 0, after: 2 }));
		const chunks = chunkMaskRanges(ranges, 180);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.flat()).toEqual(ranges);
	});

	it("applies committed object events idempotently", () => {
		const event = {
			seq: 1,
			event_id: "event-1",
			type: "chat.add",
			participant_id: "p1",
			name: "Guest",
			created_at: "2026-07-12T00:00:00Z",
			payload: { message: { id: "m1", author: "Guest", text: "hello" } },
		} satisfies LiveRoomEvent;
		const once = applyCommittedEvent(emptyDurableState(), event);
		const twice = applyCommittedEvent(once, event);
		expect(twice.chat).toHaveLength(1);
	});

	it("bounds in-memory chat while retaining newest messages", () => {
		let state = emptyDurableState();
		for (let index = 0; index <= MAX_LIVE_ROOM_CHAT_MESSAGES; index += 1) {
			state = applyCommittedEvent(state, {
				seq: index + 1,
				event_id: `event-${index}`,
				type: "chat.add",
				participant_id: "p1",
				name: "Guest",
				created_at: "2026-07-12T00:00:00Z",
				payload: { message: { id: `message-${index}`, author: "Guest", text: String(index) } },
			});
		}
		expect(state.chat).toHaveLength(MAX_LIVE_ROOM_CHAT_MESSAGES);
		expect(state.chat[0].text).toBe("1");
	});

	it("auto-joins only the creator once", () => {
		const roomId = "00000000-0000-4000-8000-000000000001";
		const key = liveRoomCreatorAutoJoinKey(roomId);
		sessionStorage.setItem(key, "1");
		expect(consumeCreatorAutoJoinName(roomId, "Creator")).toBe("Creator");
		expect(sessionStorage.getItem(key)).toBeNull();
		expect(consumeCreatorAutoJoinName(roomId, "Creator")).toBeNull();
	});
});

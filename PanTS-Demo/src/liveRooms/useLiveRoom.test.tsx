import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDurableState } from "./protocol";
import type { LiveRoomEvent } from "./types";
import { useLiveRoom } from "./useLiveRoom";

type SocketEvent = { code?: number; data?: string };
type SocketListener = (event: SocketEvent) => void;

class MockWebSocket {
	static readonly OPEN = 1;
	static instances: MockWebSocket[] = [];
	readyState = 0;
	sent: string[] = [];
	private listeners: Record<string, SocketListener[]> = {};

	constructor(_url: string) {
		MockWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: SocketListener) {
		(this.listeners[type] ??= []).push(listener);
	}

	send(frame: string) {
		this.sent.push(frame);
	}
	close() {}

	emit(type: string, event: SocketEvent = {}) {
		if (type === "open") this.readyState = MockWebSocket.OPEN;
		for (const listener of this.listeners[type] ?? []) listener(event);
	}
}

const options = (name = "Tester") => ({
	metadata: {
		room_id: "00000000-0000-4000-8000-000000000035",
		case_id: "35",
		resolution: "low" as const,
		created_at: "2026-07-13T00:00:00Z",
		expires_at: "2026-07-14T00:00:00Z",
		geometry_hash: "hash",
		dimensions: [4, 4, 2],
		latest_seq: 0,
	},
	roomKey: "secret",
	name,
	maskUrl: "blob:mask",
	maskSequence: 0,
	initialState: emptyDurableState(),
});

function connect(socket: MockWebSocket) {
	act(() => {
		socket.emit("open");
		socket.emit("message", { data: JSON.stringify({ type: "room.ready", participants: [], events: [] }) });
	});
}

function chatEvent(seq: number): LiveRoomEvent {
	return {
		seq,
		event_id: `event-${seq}`,
		type: "chat.add",
		participant_id: "peer",
		name: "Peer",
		created_at: "2026-07-13T00:00:00Z",
		payload: { message: { id: `message-${seq}`, author: "Peer", text: String(seq) } },
	};
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	MockWebSocket.instances = [];
});

describe("useLiveRoom socket lifecycle", () => {
	it("ignores delayed close events from Strict Mode's replaced socket", () => {
		vi.useFakeTimers();
		vi.stubGlobal("WebSocket", MockWebSocket);
		const { rerender, unmount } = renderHook(({ name }) => useLiveRoom(options(name)), {
			initialProps: { name: "Tester one" },
		});

		rerender({ name: "Tester two" });
		expect(MockWebSocket.instances).toHaveLength(2);
		act(() => {
			MockWebSocket.instances[0].emit("close", { code: 1006 });
			vi.advanceTimersByTime(1_000);
		});
		expect(MockWebSocket.instances).toHaveLength(2);
		unmount();
	});

	it("keeps transient callback identities stable across room updates", () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const { result, unmount } = renderHook(() => useLiveRoom(options()));
		const sendPresence = result.current.sendPresence;
		const sendView = result.current.sendView;
		connect(MockWebSocket.instances[0]);
		expect(result.current.connectionState).toBe("connected");
		expect(result.current.sendPresence).toBe(sendPresence);
		expect(result.current.sendView).toBe(sendView);
		unmount();
	});

	it("sends latest throttled presence instead of dropping final position", () => {
		vi.useFakeTimers();
		vi.stubGlobal("WebSocket", MockWebSocket);
		const { result, unmount } = renderHook(() => useLiveRoom(options()));
		const socket = MockWebSocket.instances[0];
		connect(socket);
		act(() => {
			result.current.sendPresence({ plane: "axial" });
			result.current.sendPresence({ plane: "coronal" });
		});
		let presence = socket.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "presence.update");
		expect(presence).toHaveLength(1);
		expect(presence[0].payload.plane).toBe("axial");
		act(() => vi.advanceTimersByTime(50));
		presence = socket.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "presence.update");
		expect(presence).toHaveLength(2);
		expect(presence[1].payload.plane).toBe("coronal");
		unmount();
	});

	it("does not reconnect after fatal protocol errors", () => {
		vi.useFakeTimers();
		vi.stubGlobal("WebSocket", MockWebSocket);
		const { result, unmount } = renderHook(() => useLiveRoom(options()));
		const socket = MockWebSocket.instances[0];
		connect(socket);
		act(() => {
			socket.emit("message", { data: JSON.stringify({ type: "error", fatal: true, message: "Invalid key" }) });
			socket.emit("close", { code: 4003 });
			vi.advanceTimersByTime(30_000);
		});
		expect(result.current.connectionState).toBe("error");
		expect(MockWebSocket.instances).toHaveLength(1);
		unmount();
	});

	it("rejects empty mask patches without reporting a successful send", () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const { result, unmount } = renderHook(() => useLiveRoom(options()));
		connect(MockWebSocket.instances[0]);
		expect(result.current.sendDurable("mask.patch", {
			operation_id: "empty",
			geometry_hash: "hash",
			resolution: "low",
			segment_label: 1,
			ranges: [],
		})).toBe(false);
		unmount();
	});

	it("buffers out-of-order commits and delivers them exactly in sequence", () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const { result, unmount } = renderHook(() => useLiveRoom(options()));
		const socket = MockWebSocket.instances[0];
		connect(socket);
		act(() => socket.emit("message", { data: JSON.stringify({ type: "event.committed", event: chatEvent(2) }) }));
		expect(result.current.pendingEvents).toEqual([]);
		act(() => socket.emit("message", { data: JSON.stringify({ type: "event.committed", event: chatEvent(1) }) }));
		expect(result.current.pendingEvents.map(({ event }) => event.seq)).toEqual([1, 2]);
		expect(result.current.state.chat.map((message) => message.text)).toEqual(["1", "2"]);
		act(() => result.current.acknowledgeEvents(1));
		expect(result.current.pendingEvents.map(({ event }) => event.seq)).toEqual([2]);
		unmount();
	});

	it("marks every bootstrap event for viewport replay, including self edits", () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const { result, unmount } = renderHook(() => useLiveRoom(options()));
		const socket = MockWebSocket.instances[0];
		const first = { ...chatEvent(1), participant_id: result.current.participantId };
		const second = { ...chatEvent(2), participant_id: result.current.participantId };
		act(() => {
			socket.emit("open");
			socket.emit("message", {
				data: JSON.stringify({ type: "room.ready", participants: [], events: [first, second] }),
			});
		});
		expect(result.current.pendingEvents).toHaveLength(2);
		expect(result.current.pendingEvents.every((delivery) => delivery.replayed)).toBe(true);
		unmount();
	});
});

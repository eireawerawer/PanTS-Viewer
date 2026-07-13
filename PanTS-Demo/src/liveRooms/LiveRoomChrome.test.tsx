import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveRoomDock } from "./LiveRoomChrome";
import type { LiveRoomController } from "./types";

function controller(overrides: Partial<LiveRoomController> = {}): LiveRoomController {
	return {
		metadata: {
			room_id: "room-1", case_id: "35", resolution: "low",
			created_at: "2026-07-12T00:00:00Z", expires_at: "2026-07-13T00:00:00Z",
			geometry_hash: "hash", dimensions: [4, 4, 2], latest_seq: 0,
		},
		roomKey: "secret",
		maskUrl: "blob:mask",
		participantId: "self",
		name: "Ronit",
		connectionState: "connected",
		participants: [
			{ participant_id: "self", name: "Ronit", color: "#22d3ee" },
			{ participant_id: "peer", name: "Maya", color: "#f59e0b", plane: "axial" },
		],
		state: { measurements: {}, notes: {}, chat: [] },
		pendingEvents: [],
		acknowledgeEvents: vi.fn(),
		followingId: null,
		error: null,
		undoNotice: null,
		sendDurable: vi.fn(), sendPresence: vi.fn(), sendView: vi.fn(), sendChat: vi.fn(),
		addNote: vi.fn(), deleteNote: vi.fn(), requestUndo: vi.fn(), follow: vi.fn(),
		stopFollowing: vi.fn(), copyShareLink: vi.fn(), downloadExport: vi.fn(),
		...overrides,
	};
}

describe("Live Room collaboration chrome", () => {
	it("shows equal participants and lets anyone follow another participant", () => {
		const room = controller();
		render(<LiveRoomDock room={room} crosshair={null} activePlane="axial" onClose={vi.fn()} />);
		expect(screen.getByText("Ronit (you)")).toBeInTheDocument();
		expect(screen.getByText("Maya")).toBeInTheDocument();
		expect(screen.queryByText(/owner|host|admin/i)).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Follow" }));
		expect(room.follow).toHaveBeenCalledWith("peer");
	});

	it("disables collaborative composition while reconnecting", () => {
		const room = controller({ connectionState: "reconnecting" });
		render(<LiveRoomDock room={room} crosshair={[1, 2, 3]} activePlane="axial" onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("tab", { name: /Chat/ }));
		expect(screen.getByLabelText("Room message")).toBeDisabled();
		expect(screen.getByText(/not being saved/i)).toBeInTheDocument();
	});
});

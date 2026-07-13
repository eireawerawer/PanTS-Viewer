import type { MaskRange, SharedMeasurement, SharedMprView } from "../helpers/CornerstoneNifti2";

export type LiveRoomMetadata = {
	room_id: string;
	case_id: string;
	resolution: "low" | "full";
	created_at: string;
	expires_at: string;
	geometry_hash: string;
	dimensions: number[];
	latest_seq: number;
};

export type LiveRoomMeasurement = SharedMeasurement & { revision?: number; _seq?: number };

export type LiveRoomNote = {
	id: string;
	author: string;
	text: string;
	world: [number, number, number];
	plane: string;
	organ_label?: string;
	revision?: number;
	_seq?: number;
};

export type LiveRoomChatMessage = {
	id: string;
	author: string;
	text: string;
	timestamp?: string;
	_seq?: number;
};

export type LiveRoomDurableState = {
	measurements: Record<string, LiveRoomMeasurement>;
	notes: Record<string, LiveRoomNote>;
	chat: LiveRoomChatMessage[];
	undone_event_ids?: string[];
};

export type LiveRoomMaskPatch = {
	operation_id: string;
	geometry_hash: string;
	resolution: "low" | "full";
	segment_label: number;
	ranges: MaskRange[];
};

export type LiveRoomEvent = {
	seq: number;
	event_id: string;
	type: "measurement.upsert" | "measurement.delete" | "mask.patch" | "note.upsert" | "note.delete" | "chat.add";
	participant_id: string;
	name: string;
	created_at: string;
	payload: Record<string, unknown>;
	undo_of?: string;
};

export type LiveRoomEventDelivery = {
	event: LiveRoomEvent;
	replayed: boolean;
};

export type LiveRoomParticipant = {
	participant_id: string;
	name: string;
	color: string;
	cursor?: { pane: string; x: number; y: number };
	crosshair?: [number, number, number];
	active_tool?: string;
	target_organ?: string;
	plane?: string;
	following?: string | null;
	view?: SharedMprView & {
		windowWidth?: number;
		windowCenter?: number;
		opacity?: number;
		visibleOrgans?: boolean[];
	};
};

export type LiveRoomConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected" | "expired" | "error";

export type LiveRoomController = {
	metadata: LiveRoomMetadata;
	roomKey: string;
	maskUrl: string;
	participantId: string;
	name: string;
	connectionState: LiveRoomConnectionState;
	participants: LiveRoomParticipant[];
	state: LiveRoomDurableState;
	pendingEvents: LiveRoomEventDelivery[];
	acknowledgeEvents: (throughSequence: number) => void;
	followingId: string | null;
	error: string | null;
	undoNotice: string | null;
	sendDurable: (type: LiveRoomEvent["type"], payload: Record<string, unknown>, eventId?: string) => boolean;
	sendPresence: (payload: Record<string, unknown>) => void;
	sendView: (payload: Record<string, unknown>) => void;
	sendChat: (text: string) => boolean;
	addNote: (text: string, world: [number, number, number], plane: string, organLabel?: string) => boolean;
	deleteNote: (id: string) => boolean;
	requestUndo: () => void;
	follow: (participantId: string) => void;
	stopFollowing: () => void;
	copyShareLink: () => Promise<void>;
	downloadExport: (kind: "zip" | "pdf") => Promise<void>;
};

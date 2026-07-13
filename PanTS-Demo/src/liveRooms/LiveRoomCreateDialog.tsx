import { IconUsersGroup, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { API_BASE } from "../helpers/constants";
import { liveRoomCreatorAutoJoinKey } from "./protocol";
import "./liveRooms.css";

type Props = {
	caseId: string;
	open: boolean;
	onClose: () => void;
};

export default function LiveRoomCreateDialog({ caseId, open, onClose }: Props) {
	const [name, setName] = useState(() => sessionStorage.getItem("bodymaps.live-room.name") || "");
	const [resolution, setResolution] = useState<"low" | "full">("low");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !submitting) onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose, open, submitting]);

	if (!open) return null;

	const create = async (event: React.FormEvent) => {
		event.preventDefault();
		const cleanName = name.trim();
		if (!cleanName) {
			setError("Enter a display name.");
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			const response = await fetch(`${API_BASE}/api/live-rooms`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ case_id: caseId, resolution }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error || `Could not create room (${response.status})`);
			sessionStorage.setItem("bodymaps.live-room.name", cleanName);
			sessionStorage.setItem(`bodymaps.live-room.${body.room_id}.case-id`, caseId);
			sessionStorage.setItem(liveRoomCreatorAutoJoinKey(body.room_id), "1");
			window.location.assign(body.share_url);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not create Live Room");
			setSubmitting(false);
		}
	};

	return (
		<div className="lr-modal-backdrop" role="presentation" onMouseDown={(event) => {
			if (event.target === event.currentTarget && !submitting) onClose();
		}}>
			<form className="lr-modal" role="dialog" aria-modal="true" aria-labelledby="lr-create-title" onSubmit={create}>
				<div className="lr-modal__head">
					<div>
						<span className="lr-eyebrow">Case {caseId}</span>
						<h2 id="lr-create-title">Start a Live Room</h2>
					</div>
					<button type="button" className="lr-icon-button" onClick={onClose} aria-label="Close" disabled={submitting}>
						<IconX size={20} />
					</button>
				</div>
				<p className="lr-modal__intro">Share link. Review one scan together. No account required.</p>
				<label className="lr-field">
					<span>Display name</span>
					<input autoFocus maxLength={32} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
				</label>
				<fieldset className="lr-resolution">
					<legend>Resolution</legend>
					<label className={resolution === "low" ? "is-selected" : ""}>
						<input type="radio" name="resolution" checked={resolution === "low"} onChange={() => setResolution("low")} />
						<span><strong>Fast preview</strong><small>Recommended for smooth collaboration</small></span>
					</label>
					<label className={resolution === "full" ? "is-selected" : ""}>
						<input type="radio" name="resolution" checked={resolution === "full"} onChange={() => setResolution("full")} />
						<span><strong>Full resolution</strong><small>Available when server copy exists</small></span>
					</label>
				</fieldset>
				<div className="lr-capability-note">
					<IconUsersGroup size={18} />
					<span>Anyone with link can edit. Room supports 8 people and expires after 24 hours.</span>
				</div>
				{error && <div className="lr-error" role="alert">{error}</div>}
				<div className="lr-modal__actions">
					<button type="button" className="lr-button lr-button--secondary" onClick={onClose} disabled={submitting}>Cancel</button>
					<button className="lr-button lr-button--primary" disabled={submitting || !name.trim()}>
						{submitting ? "Creating…" : "Create Live Room"}
					</button>
				</div>
			</form>
		</div>
	);
}

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/authContext";
import { ACCOUNT_TYPES, type AccountType } from "../../helpers/accountProfile";
import { useSettings } from "./context";

// Profile: avatar, name, email, and the self-reported account type.
//
// The account type used to be a required signup step with four descriptive
// cards. Nothing reads it, so it's a plain optional select here — asking a
// question that changes nothing is worse than not asking it.
const ProfileSettings: React.FC = () => {
	const navigate = useNavigate();
	const { user, updateName, updateAccountProfile, signOut } = useAuth();
	const { busy, run, notify } = useSettings();

	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");

	if (!user) return null;

	const save = () =>
		run(async () => {
			await updateName(draft.trim());
			setEditing(false);
			notify("Your name has been updated.");
		});

	return (
		<div className="set-group">
			<h2 className="set-heading">Profile</h2>

			<div className="set-row">
				<span className="set-row-label">Avatar</span>
				<span className="set-avatar">
					{(user.name || user.email).charAt(0).toUpperCase()}
				</span>
			</div>

			<div className="set-row">
				<span className="set-row-label">Name</span>
				{editing ? (
					<div className="set-row-edit">
						<input
							className="set-input"
							value={draft}
							autoFocus
							maxLength={120}
							aria-label="Display name"
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") save();
								if (e.key === "Escape") setEditing(false);
							}}
						/>
						<button
							type="button"
							className="set-btn set-btn--primary"
							disabled={busy}
							onClick={save}
						>
							{busy ? "Saving…" : "Save"}
						</button>
						<button type="button" className="set-btn" onClick={() => setEditing(false)}>
							Cancel
						</button>
					</div>
				) : (
					<div className="set-row-edit">
						<span className="set-row-value">{user.name}</span>
						<button
							type="button"
							className="set-btn"
							onClick={() => {
								setDraft(user.hasCustomName ? user.name : "");
								setEditing(true);
							}}
						>
							{user.hasCustomName ? "Edit" : "Add"}
						</button>
					</div>
				)}
			</div>

			<div className="set-row">
				<span className="set-row-label">Email</span>
				<span className="set-row-value">{user.email}</span>
			</div>

			<div className="set-row">
				<span className="set-row-label">
					Role
					<span className="set-row-note">Optional. Doesn't affect what you can access.</span>
				</span>
				<select
					className="set-select"
					aria-label="Role"
					value={user.profile.accountType ?? ""}
					onChange={(e) =>
						updateAccountProfile({
							accountType: (e.target.value || null) as AccountType | null,
						})
					}
				>
					<option value="">Not set</option>
					{ACCOUNT_TYPES.map((t) => (
						<option key={t.id} value={t.id}>{t.label}</option>
					))}
				</select>
			</div>

			<div className="set-row">
				<span className="set-row-label">Sign out</span>
				<button
					type="button"
					className="set-btn"
					onClick={() => { signOut(); navigate("/"); }}
				>
					Sign out
				</button>
			</div>
		</div>
	);
};

export default ProfileSettings;

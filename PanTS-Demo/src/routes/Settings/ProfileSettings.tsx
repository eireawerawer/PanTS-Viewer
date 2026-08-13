import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/authContext";
import { ACCOUNT_TYPES, accountTypeLabel, type AccountType } from "../../helpers/accountProfile";
import { track } from "../../helpers/analytics";
import { useSettings } from "./context";

// Profile: who you are, one preference, and the way out.
//
// The name is a live field rather than an Add/Save/Cancel dance — Claude puts a
// plain text input in the row and commits on blur, which is three interactions
// fewer for the same result.
//
// The account type used to be a required signup step with four descriptive
// cards. It's an optional select here: it still gates nothing, it's just
// reported on. It lives on the account, so it follows the user between browsers.
const ProfileSettings: React.FC = () => {
	const navigate = useNavigate();
	const {
		user, updateName, updateAccountProfile, updatePreferences, signOut,
	} = useAuth();
	const { run, notify } = useSettings();

	// What the server currently holds. A name derived from the email isn't a
	// value the user chose, so it shows as a placeholder rather than text they'd
	// have to delete before typing their own.
	const committed = user?.hasCustomName ? user.name : "";

	// Seeded from the account, then owned by the field while it's being edited.
	const [draft, setDraft] = useState(committed);
	useEffect(() => {
		setDraft(committed);
	}, [committed]);

	if (!user) return null;

	// Commit on blur (and on Enter). No-op when nothing changed, so tabbing
	// through the form doesn't fire a request per field.
	const commitName = () => {
		const next = draft.trim();
		if (next === committed) return;
		run(async () => {
			await updateName(next);
			notify(next ? "Your name has been updated." : "Your name has been cleared.");
		});
	};

	return (
		<>
			<div className="set-group">
				<h2 className="set-heading">Profile</h2>

				<div className="set-row">
					<span className="set-row-label">Avatar</span>
					<span className="set-avatar">
						{(user.name || user.email).charAt(0).toUpperCase()}
					</span>
				</div>

				<div className="set-row">
					<label className="set-row-label" htmlFor="set-name">Name</label>
					<input
						id="set-name"
						className="set-input"
						value={draft}
						maxLength={120}
						placeholder={user.hasCustomName ? "" : user.name}
						onChange={(e) => setDraft(e.target.value)}
						onBlur={commitName}
						onKeyDown={(e) => {
							if (e.key === "Enter") e.currentTarget.blur();
							if (e.key === "Escape") setDraft(committed);
						}}
					/>
				</div>

				<div className="set-row">
					<span className="set-row-label">Email</span>
					<span className="set-row-value">{user.email}</span>
				</div>

				<div className="set-row">
					<label className="set-row-label" htmlFor="set-role">
						Role
						<span className="set-row-note">Optional. Doesn't affect what you can access.</span>
					</label>
					<select
						id="set-role"
						className="set-select"
						value={user.profile.accountType ?? ""}
						onChange={(e) => {
							const accountType = (e.target.value || null) as AccountType | null;
							run(async () => {
								track("account_set_account_type");
								await updateAccountProfile({ accountType });
								notify(
									accountType
										? `Your role is set to ${accountTypeLabel(accountType)}.`
										: "Your role has been cleared."
								);
							});
						}}
					>
						<option value="">Not set</option>
						{ACCOUNT_TYPES.map((t) => (
							<option key={t.id} value={t.id}>{t.label}</option>
						))}
					</select>
				</div>
			</div>

			<div className="set-group">
				<h2 className="set-heading">Notifications</h2>

				<div className="set-row">
					<span className="set-row-label">Email me when a scan finishes</span>
					<button
						type="button"
						role="switch"
						aria-checked={user.emailNotifications}
						aria-label="Email me when a scan finishes"
						className={`set-switch${user.emailNotifications ? " set-switch--on" : ""}`}
						onClick={() => updatePreferences({ emailNotifications: !user.emailNotifications })}
					>
						<span className="set-switch-knob" />
					</button>
				</div>
			</div>

			<div className="set-group">
				<h2 className="set-heading">Session</h2>

				<div className="set-row">
					{/* Not "log out of all devices": /auth/logout revokes this session
					    only, so claiming otherwise would be a lie. */}
					<span className="set-row-label">Signed in on this browser</span>
					<button
						type="button"
						className="set-btn"
						onClick={() => { signOut(); navigate("/"); }}
					>
						Sign out
					</button>
				</div>
			</div>
		</>
	);
};

export default ProfileSettings;

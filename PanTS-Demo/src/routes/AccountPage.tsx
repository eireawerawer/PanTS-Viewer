import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../contexts/authContext";
import "./AccountPage.css";

// Account settings: profile (with an editable display name), the email
// notification preference, data export, and the destructive controls. Sends you
// home + opens the sign-in popup if reached signed out.
//
// Every action here hits a real endpoint. Deleting the account is reversible for
// a grace period the server reports back, and the confirmation says so.
const AccountPage: React.FC = () => {
	const navigate = useNavigate();
	const {
		user, isAuthenticated, loading, signOut, updatePreferences,
		updateName, exportData, deleteScanHistory, deleteAccount, promptAuth,
	} = useAuth();

	const [editingName, setEditingName] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	// Which destructive action is awaiting type-to-confirm (null = none).
	const [confirming, setConfirming] = useState<"history" | "account" | null>(null);
	const [confirmText, setConfirmText] = useState("");
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const [error, setError] = useState("");

	// Wait for the initial /me check before deciding. Without the `loading` guard
	// a hard refresh on /account bounces you to the landing page, because the
	// session cookie hasn't been exchanged for a user yet on first render.
	useEffect(() => {
		if (!loading && !isAuthenticated) {
			navigate("/", { replace: true });
			promptAuth("signin");
		}
	}, [loading, isAuthenticated, navigate, promptAuth]);

	// Success messages clear themselves after a few seconds — they confirm
	// something that already happened, so leaving one pinned there indefinitely
	// makes the page look stuck. Errors are left up: those need acting on.
	useEffect(() => {
		if (!notice) return;
		const t = setTimeout(() => setNotice(""), 6000);
		return () => clearTimeout(t);
	}, [notice]);

	if (!user) return null;

	// One wrapper so every action reports failure the same way instead of
	// silently doing nothing.
	const run = async (fn: () => Promise<void>) => {
		setBusy(true);
		setError("");
		setNotice("");
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	};

	const saveName = () =>
		run(async () => {
			await updateName(nameDraft.trim());
			setEditingName(false);
			setNotice("Your name has been updated.");
		});

	const doExport = () =>
		run(async () => {
			await exportData();
			setNotice("Your data has been downloaded.");
		});

	const confirmWord = confirming === "account" ? "DELETE" : "CLEAR";

	const runDestructive = () =>
		run(async () => {
			if (confirming === "history") {
				const count = await deleteScanHistory();
				setConfirming(null);
				setConfirmText("");
				setNotice(
					count === 0
						? "You had no scans to delete."
						: `Deleted ${count} scan${count === 1 ? "" : "s"} and their results.`
				);
				return;
			}
			// authContext parks the "still restorable" message on the sign-in
			// popup, which is where deleting drops you and where you'd act on it.
			await deleteAccount();
			navigate("/", { replace: true });
		});

	return (
		<div className="account-wrapper">
			<Header />
			<main className="account-main">
				<h1 className="account-title">Account</h1>

				{notice && <div className="account-notice">{notice}</div>}
				{error && <div className="account-notice account-notice--error">{error}</div>}

				{/* Profile */}
				<section className="account-section">
					<div className="account-section-label">Profile</div>
					<div className="account-panel">
						<div className="account-profile">
							<span className="account-avatar">
								{(user.name || user.email).charAt(0).toUpperCase()}
							</span>
							<div className="account-profile-body">
								{editingName ? (
									<div className="account-name-edit">
										<input
											className="account-input"
											value={nameDraft}
											autoFocus
											maxLength={120}
											placeholder="Your name"
											aria-label="Display name"
											onChange={(e) => setNameDraft(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") saveName();
												if (e.key === "Escape") setEditingName(false);
											}}
										/>
										<button
											type="button"
											className="account-btn account-btn--primary"
											disabled={busy}
											onClick={saveName}
										>
											{busy ? "Saving…" : "Save"}
										</button>
										<button
											type="button"
											className="account-btn"
											onClick={() => setEditingName(false)}
										>
											Cancel
										</button>
									</div>
								) : (
									<>
										<div className="account-name">{user.name}</div>
										<div className="account-email">{user.email}</div>
										{!user.hasCustomName && (
											<div className="account-row-desc">
												We guessed this from your email address.
											</div>
										)}
									</>
								)}
							</div>
							{!editingName && (
								<button
									type="button"
									className="account-btn"
									onClick={() => {
										setNameDraft(user.hasCustomName ? user.name : "");
										setEditingName(true);
									}}
								>
									{user.hasCustomName ? "Edit name" : "Add name"}
								</button>
							)}
						</div>
					</div>
				</section>

				{/* Notifications */}
				<section className="account-section">
					<div className="account-section-label">Notifications</div>
					<div className="account-panel">
						<label className="account-row">
							<div>
								<div className="account-row-title">Email me when inference finishes</div>
								<div className="account-row-desc">
									Get an email as soon as a scan's segmentation is ready, so you don't
									have to keep the tab open.
								</div>
							</div>
							<button
								type="button"
								role="switch"
								aria-checked={user.emailNotifications}
								className={`account-switch${user.emailNotifications ? " account-switch--on" : ""}`}
								onClick={() =>
									updatePreferences({ emailNotifications: !user.emailNotifications })
								}
							>
								<span className="account-switch-knob" />
							</button>
						</label>
					</div>
				</section>

				{/* Data */}
				<section className="account-section">
					<div className="account-section-label">Your data</div>
					<div className="account-panel">
						<div className="account-row">
							<div>
								<div className="account-row-title">Export my data</div>
								<div className="account-row-desc">
									Download your account details and the full record of every scan
									you've run, as a JSON file. Available any time — you don't have to
									be leaving to take a copy.
								</div>
							</div>
							<button type="button" className="account-btn" disabled={busy} onClick={doExport}>
								Export
							</button>
						</div>
					</div>
				</section>

				{/* Danger zone */}
				<section className="account-section">
					<div className="account-section-label">Danger zone</div>
					<div className="account-panel account-panel--danger">
						<div className="account-row">
							<div>
								<div className="account-row-title">Delete scan history</div>
								<div className="account-row-desc">
									Permanently deletes every scan you've uploaded and every
									segmentation produced from them. Your account stays. This can't be
									undone.
								</div>
							</div>
							<button
								type="button"
								className="account-danger-btn"
								onClick={() => { setConfirming("history"); setConfirmText(""); setError(""); }}
							>
								Delete history
							</button>
						</div>

						<div className="account-row">
							<div>
								<div className="account-row-title">Delete account</div>
								<div className="account-row-desc">
									Signs you out everywhere and schedules your account and all your
									scans for deletion. You have 30 days to change your mind — just
									sign back in and everything is restored.
								</div>
							</div>
							<button
								type="button"
								className="account-danger-btn"
								onClick={() => { setConfirming("account"); setConfirmText(""); setError(""); }}
							>
								Delete account
							</button>
						</div>

						{confirming && (
							<div className="account-confirm" role="alertdialog" aria-label="Confirm">
								<div className="account-confirm-text">
									Type <strong>{confirmWord}</strong> to confirm.
								</div>
								<div className="account-confirm-actions">
									<input
										className="account-input"
										value={confirmText}
										autoFocus
										aria-label={`Type ${confirmWord} to confirm`}
										onChange={(e) => setConfirmText(e.target.value)}
									/>
									<button
										type="button"
										className="account-danger-btn"
										disabled={busy || confirmText.trim() !== confirmWord}
										onClick={runDestructive}
									>
										{busy ? "Working…" : "Confirm"}
									</button>
									<button
										type="button"
										className="account-btn"
										onClick={() => { setConfirming(null); setConfirmText(""); }}
									>
										Cancel
									</button>
								</div>
							</div>
						)}
					</div>
				</section>

				{/* Session */}
				<section className="account-section">
					<div className="account-section-label">Session</div>
					<div className="account-panel">
						<div className="account-row">
							<div>
								<div className="account-row-title">Sign out</div>
								<div className="account-row-desc">End this session on this browser.</div>
							</div>
							<button
								type="button"
								className="account-signout"
								onClick={() => {
									signOut();
									navigate("/");
								}}
							>
								Sign out
							</button>
						</div>
					</div>
				</section>
			</main>
		</div>
	);
};

export default AccountPage;

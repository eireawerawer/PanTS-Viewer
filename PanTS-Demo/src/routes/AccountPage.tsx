import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useAuth } from "../contexts/authContext";
import "./AccountPage.css";

// Account settings: profile summary, the email-notification preference (the
// "notify me when inference finishes" control lives here, per the mock spec),
// and sign out. Sends you home + opens the sign-in popup if reached signed out.
const AccountPage: React.FC = () => {
	const navigate = useNavigate();
	const { user, isAuthenticated, signOut, updatePreferences, promptAuth } = useAuth();

	useEffect(() => {
		if (!isAuthenticated) {
			navigate("/", { replace: true });
			promptAuth("signin");
		}
	}, [isAuthenticated, navigate, promptAuth]);

	if (!user) return null;

	return (
		<div className="account-wrapper">
			<Header />
			<main className="account-main">
				<h1 className="account-title">Account</h1>

				{/* Profile */}
				<section className="account-section">
					<div className="account-section-label">Profile</div>
					<div className="account-panel">
						<div className="account-profile">
							<span className="account-avatar">
								{(user.name || user.email).charAt(0).toUpperCase()}
							</span>
							<div>
								<div className="account-name">{user.name}</div>
								<div className="account-email">{user.email}</div>
							</div>
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

				{/* Danger / session */}
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

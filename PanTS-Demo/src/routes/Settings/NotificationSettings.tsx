import React from "react";
import { useAuth } from "../../contexts/authContext";

// Notifications. One switch today; its own section so adding the next one
// doesn't mean re-cutting the navigation.
const NotificationSettings: React.FC = () => {
	const { user, updatePreferences } = useAuth();
	if (!user) return null;

	return (
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
	);
};

export default NotificationSettings;

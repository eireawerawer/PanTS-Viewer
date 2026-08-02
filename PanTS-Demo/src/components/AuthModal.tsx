import { IconBrandGithub, IconBrandGoogle } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/authContext";
import "./AuthModal.css";

// Global sign-IN popup (light theme, World Labs layout). Opened via
// authContext.promptAuth() from the header and from gated upload actions.
// Email/password posts to the API; the provider buttons hand the browser to the
// backend's OAuth redirect (and are disabled if that provider isn't configured).
//
// Signing UP is a full page (routes/SignupPage) — creating an account now
// involves picking an account type and a plan, which doesn't belong in a popup.
// This modal only links there.
const AuthModal: React.FC = () => {
	const {
		authPrompt, closeAuthPrompt, signIn,
		signInWithProvider, oauthProviders, oauthError, clearOauthError,
	} = useAuth();

	// "email mode" reveals the email/password form (World Labs' "Continue with email").
	const [emailMode, setEmailMode] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	// Reset transient form state whenever the popup opens/closes.
	useEffect(() => {
		if (!authPrompt.open) {
			setEmailMode(false);
			setEmail(""); setPassword(""); setError(""); setBusy(false);
		}
	}, [authPrompt.open]);

	// Surface an error the OAuth callback redirected back with.
	useEffect(() => {
		if (oauthError) setError(oauthError);
	}, [oauthError]);

	// Closing the popup also clears a pending OAuth error so it doesn't reappear.
	const dismiss = () => {
		clearOauthError();
		closeAuthPrompt();
	};

	// Close on Esc.
	useEffect(() => {
		if (!authPrompt.open) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [authPrompt.open, closeAuthPrompt]);

	if (!authPrompt.open) return null;

	const submitEmail = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		if (!email.trim() || !password) { setError("Enter an email and password."); return; }
		setBusy(true);
		try {
			await signIn(email, password);
			// authContext auto-closes the popup once the user is set.
		} catch (err) {
			// Surface the API's message ("Invalid email or password", ...) rather
			// than a generic string.
			setError(err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="authm-backdrop" onClick={dismiss}>
			<div className="authm-card" role="dialog" aria-modal="true" aria-label="Sign in" onClick={(e) => e.stopPropagation()}>
				<button type="button" className="authm-close" aria-label="Close" onClick={dismiss}>×</button>

				<img src="/bodymaps-logo.svg" alt="" className="authm-logo" />
				<h2 className="authm-title">Sign in</h2>

				{!emailMode ? (
					<>
						{/* A provider with no server-side credentials stays disabled. */}
						<button
							type="button"
							className="authm-provider"
							disabled={oauthProviders?.google === false}
							title={oauthProviders?.google === false ? "Not configured on this server" : undefined}
							onClick={() => signInWithProvider("google")}
						>
							<IconBrandGoogle size={18} />
							Sign in with Google
						</button>
						<button
							type="button"
							className="authm-provider"
							disabled={oauthProviders?.github === false}
							title={oauthProviders?.github === false ? "Not configured on this server" : undefined}
							onClick={() => signInWithProvider("github")}
						>
							<IconBrandGithub size={18} />
							Sign in with GitHub
						</button>

						{/* Errors bounced back from the OAuth callback land here. */}
						{error && <div className="authm-error">{error}</div>}

						<div className="authm-divider"><span>or</span></div>

						<button type="button" className="authm-email-btn" onClick={() => setEmailMode(true)}>
							Continue with email
						</button>
					</>
				) : (
					<form className="authm-form" onSubmit={submitEmail}>
						<label className="authm-field">
							<span className="authm-label">Email</span>
							<input type="email" autoComplete="email" className="authm-input" value={email}
								onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
						</label>
						<label className="authm-field">
							<span className="authm-label">Password</span>
							<input type="password" autoComplete="current-password" className="authm-input"
								value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
						</label>
						{error && <div className="authm-error">{error}</div>}
						<button type="submit" className="authm-submit" disabled={busy}>
							{busy ? "…" : "Sign in"}
						</button>
						<button type="button" className="authm-back" onClick={() => setEmailMode(false)}>
							← Other sign-in options
						</button>
					</form>
				)}

				<div className="authm-toggle">
					Don't have an account?{" "}
					<Link to="/signup" className="authm-link" onClick={dismiss}>Sign up</Link>
				</div>
			</div>
		</div>
	);
};

export default AuthModal;

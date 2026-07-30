import { IconBrandGithub, IconBrandGoogle } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/authContext";
import "./AuthModal.css";

// Global sign-in / sign-up popup (light theme, World Labs layout). Opened via
// authContext.promptAuth() from the header and from gated upload actions.
// Email/password posts to the API; the provider buttons hand the browser to the
// backend's OAuth redirect (and are disabled if that provider isn't configured).
const AuthModal: React.FC = () => {
	const {
		authPrompt, promptAuth, closeAuthPrompt, signIn, signUp,
		signInWithProvider, oauthProviders, oauthError, clearOauthError,
	} = useAuth();
	const isSignup = authPrompt.mode === "signup";

	// "email mode" reveals the email/password form (World Labs' "Continue with email").
	const [emailMode, setEmailMode] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	// Reset transient form state whenever the popup opens/closes or flips mode.
	useEffect(() => {
		if (!authPrompt.open) {
			setEmailMode(false);
			setEmail(""); setPassword(""); setConfirm(""); setError(""); setBusy(false);
		}
	}, [authPrompt.open, authPrompt.mode]);

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
		if (isSignup && password !== confirm) { setError("Passwords don't match."); return; }
		setBusy(true);
		try {
			if (isSignup) await signUp(email, password);
			else await signIn(email, password);
			// authContext auto-closes the popup once the user is set.
		} catch (err) {
			// Surface the API's message ("Invalid email or password", "An account
			// with that email already exists", ...) rather than a generic string.
			setError(err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="authm-backdrop" onClick={dismiss}>
			<div className="authm-card" role="dialog" aria-modal="true" aria-label={isSignup ? "Create account" : "Sign in"} onClick={(e) => e.stopPropagation()}>
				<button type="button" className="authm-close" aria-label="Close" onClick={dismiss}>×</button>

				<img src="/bodymaps-logo.svg" alt="" className="authm-logo" />
				<h2 className="authm-title">{isSignup ? "Create account" : "Sign in"}</h2>

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
							{isSignup ? "Sign up with Google" : "Sign in with Google"}
						</button>
						<button
							type="button"
							className="authm-provider"
							disabled={oauthProviders?.github === false}
							title={oauthProviders?.github === false ? "Not configured on this server" : undefined}
							onClick={() => signInWithProvider("github")}
						>
							<IconBrandGithub size={18} />
							{isSignup ? "Sign up with GitHub" : "Sign in with GitHub"}
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
							<input type="password" autoComplete={isSignup ? "new-password" : "current-password"} className="authm-input"
								value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
						</label>
						{isSignup && (
							<label className="authm-field">
								<span className="authm-label">Confirm password</span>
								<input type="password" autoComplete="new-password" className="authm-input"
									value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
							</label>
						)}
						{error && <div className="authm-error">{error}</div>}
						<button type="submit" className="authm-submit" disabled={busy}>
							{busy ? "…" : isSignup ? "Create account" : "Sign in"}
						</button>
						<button type="button" className="authm-back" onClick={() => setEmailMode(false)}>
							← Other sign-in options
						</button>
					</form>
				)}

				<div className="authm-toggle">
					{isSignup ? (
						<>Already have an account?{" "}
							<button type="button" className="authm-link" onClick={() => { setError(""); promptAuth("signin"); }}>Sign in</button></>
					) : (
						<>Don't have an account?{" "}
							<button type="button" className="authm-link" onClick={() => { setError(""); promptAuth("signup"); }}>Sign up</button></>
					)}
				</div>
			</div>
		</div>
	);
};

export default AuthModal;

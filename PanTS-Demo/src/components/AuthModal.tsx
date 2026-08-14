import { IconBrandGithub, IconBrandGoogle } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/authContext";
import { track } from "../helpers/analytics";
import "./AuthModal.css";

// The one auth popup: signing in and creating an account are the same card with
// a different title, a different submit button, and terms fine print on the
// signup side. Claude and ChatGPT both do exactly this — their log-in and
// create-account screens are the same layout throughout.
//
// Opened by authContext.promptAuth(mode) from the header, from gated upload
// actions, and from /signup — which redirects here rather than 404ing, so old
// links and bookmarks still land somewhere sensible.
//
// Providers come first with the email form behind "Continue with email", which
// keeps the default card short.
const AuthModal: React.FC = () => {
	const {
		authPrompt, closeAuthPrompt, promptAuth, signIn, signUp,
		signInWithProvider, oauthProviders, oauthError, clearOauthError,
	} = useAuth();

	const isSignup = authPrompt.mode === "signup";

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

	// Flipping between sign-in and sign-up clears the password and any error —
	// a rejected sign-in shouldn't still be showing over the signup form.
	useEffect(() => {
		setPassword(""); setError("");
	}, [authPrompt.mode]);

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
			if (isSignup) await signUp(email, password);
			else await signIn(email, password);
			// After the await: this counts successful sign-ins, not attempts.
			track(isSignup ? "auth_sign_up" : "auth_sign_in");
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
			<div
				className="authm-card"
				role="dialog"
				aria-modal="true"
				aria-label={isSignup ? "Create your account" : "Sign in"}
				onClick={(e) => e.stopPropagation()}
			>
				<button type="button" className="authm-close" aria-label="Close" onClick={dismiss}>×</button>

				<img src="/bodymaps-logo.svg" alt="" className="authm-logo" />
				<h2 className="authm-title">{isSignup ? "Create your account" : "Sign in"}</h2>

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
							Continue with Google
						</button>
						<button
							type="button"
							className="authm-provider"
							disabled={oauthProviders?.github === false}
							title={oauthProviders?.github === false ? "Not configured on this server" : undefined}
							onClick={() => signInWithProvider("github")}
						>
							<IconBrandGithub size={18} />
							Continue with GitHub
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
							<input
								type="password"
								autoComplete={isSignup ? "new-password" : "current-password"}
								className="authm-input"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={isSignup ? "At least 8 characters" : "••••••••"}
							/>
						</label>
						{error && <div className="authm-error">{error}</div>}
						<button type="submit" className="authm-submit" disabled={busy}>
							{busy ? "…" : isSignup ? "Create account" : "Sign in"}
						</button>
						<button type="button" className="authm-back" onClick={() => setEmailMode(false)}>
							← Other options
						</button>
					</form>
				)}

				{/* Consent by continuing rather than a checkbox, on the signup side
				    only — that's the moment the account is created. */}
				{isSignup && (
					<p className="authm-fineprint">
						By continuing you agree to our{" "}
						<Link to="/terms" target="_blank">Terms of Service</Link> and{" "}
						<Link to="/privacy" target="_blank">Privacy Policy</Link>.
					</p>
				)}

				<div className="authm-toggle">
					{isSignup ? (
						<>
							Already have an account?{" "}
							<button type="button" className="authm-link" onClick={() => promptAuth("signin")}>
								Sign in
							</button>
						</>
					) : (
						<>
							Don't have an account?{" "}
							<button type="button" className="authm-link" onClick={() => promptAuth("signup")}>
								Sign up
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
};

export default AuthModal;

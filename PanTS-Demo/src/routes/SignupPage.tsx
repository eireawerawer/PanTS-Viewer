import { IconBrandGithub, IconBrandGoogle } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/authContext";
import "./SignupPage.css";

// Sign-up: one screen, the way Claude and ChatGPT do it — providers, a divider,
// an email and a password, done. Both of those sites use the identical layout
// for signing in and signing up, changing only the title and the footer link.
//
// Everything that used to follow (account type, plan, a terms checkbox) is gone.
// A new account lands on Free and meets its limits when it reaches them, which
// is a better introduction than a tier chart shown before you've seen anything.
//
// Terms are inline fine print under the button rather than a step of their own:
// consent by continuing, which is the pattern on both reference sites and on
// most of the web. The links still go to /terms and /privacy for anyone who
// wants to read them.
//
// Sign-IN stays the popup (components/AuthModal) — it's a short return path.
const SignupPage: React.FC = () => {
	const navigate = useNavigate();
	const {
		isAuthenticated, loading, signUp, signInWithProvider,
		oauthProviders, promptAuth,
	} = useAuth();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	// Already signed in? Nothing to do here.
	useEffect(() => {
		if (!loading && isAuthenticated) navigate("/upload", { replace: true });
	}, [loading, isAuthenticated, navigate]);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		if (!email.trim() || !password) { setError("Enter an email and password."); return; }
		setBusy(true);
		try {
			await signUp(email, password);
			navigate("/upload", { replace: true });
		} catch (err) {
			setError(err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="signup-wrapper">
			<header className="signup-header">
				<Link to="/" className="signup-brand">
					<img src="/bodymaps-logo.svg" alt="" className="signup-logo" />
					<span>BodyMaps</span>
				</Link>
			</header>

			<main className="signup-main">
				<div className="signup-panel">
					<h1 className="signup-title">Create your account</h1>

					<div className="signup-providers">
						<button
							type="button"
							className="signup-provider"
							disabled={oauthProviders?.google === false}
							title={oauthProviders?.google === false ? "Not configured on this server" : undefined}
							onClick={() => signInWithProvider("google")}
						>
							<IconBrandGoogle size={18} /> Continue with Google
						</button>
						<button
							type="button"
							className="signup-provider"
							disabled={oauthProviders?.github === false}
							title={oauthProviders?.github === false ? "Not configured on this server" : undefined}
							onClick={() => signInWithProvider("github")}
						>
							<IconBrandGithub size={18} /> Continue with GitHub
						</button>
					</div>

					<div className="signup-divider"><span>or</span></div>

					<form className="signup-form" onSubmit={submit}>
						<label className="signup-field">
							<span className="signup-label">Email</span>
							<input
								type="email" className="signup-input" value={email} autoComplete="email"
								onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
							/>
						</label>
						<label className="signup-field">
							<span className="signup-label">Password</span>
							<input
								type="password" className="signup-input" value={password} autoComplete="new-password"
								onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
							/>
						</label>
						{error && <div className="signup-error">{error}</div>}
						<button type="submit" className="signup-primary" disabled={busy}>
							{busy ? "Creating account…" : "Create account"}
						</button>
					</form>

					<p className="signup-fineprint">
						By continuing you agree to our{" "}
						<Link to="/terms" target="_blank">Terms of Service</Link> and{" "}
						<Link to="/privacy" target="_blank">Privacy Policy</Link>. BodyMaps is
						research software and does not provide a diagnosis.
					</p>

					<div className="signup-alt">
						Already have an account?{" "}
						<button
							type="button"
							className="signup-link"
							onClick={() => { navigate("/"); promptAuth(); }}
						>
							Sign in
						</button>
					</div>
				</div>
			</main>
		</div>
	);
};

export default SignupPage;

import { IconBrandGithub, IconBrandGoogle, IconCheck } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/authContext";
import {
	ACCOUNT_TYPES,
	PLANS,
	type AccountType,
	type PlanId,
} from "../helpers/accountProfile";
import "./SignupPage.css";

// Fullscreen sign-up, modelled on how ChatGPT/Claude onboard: create the
// account, then a few questions, rather than one wall of fields. Sign-IN stays
// the popup (components/AuthModal) — it's a one-field return path and doesn't
// deserve a page.
//
// The account-type and plan answers are a client-side mock today
// (helpers/accountProfile.ts): nothing is gated, nothing is charged, no prices
// are shown. They exist so the flow is real enough to react to.
//
// ?step=type is the OAuth entry point — the provider callback lands back in the
// app, and App/authContext sends first-time users straight here with the
// account already created, so step 1 is skipped.

type Step = "account" | "type" | "plan" | "terms";
const STEPS: Step[] = ["account", "type", "plan", "terms"];
const STEP_TITLES: Record<Step, string> = {
	account: "Create your account",
	type: "How will you use BodyMaps?",
	plan: "Choose a plan",
	terms: "Terms and privacy",
};

const SignupPage: React.FC = () => {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const {
		user, isAuthenticated, loading, signUp, signInWithProvider,
		oauthProviders, updateAccountProfile, promptAuth,
	} = useAuth();

	// Steps after the first need an account to attach answers to, so an
	// unauthenticated visitor always starts at step 1 regardless of ?step.
	const requestedStep = searchParams.get("step") as Step | null;
	const [step, setStep] = useState<Step>(
		requestedStep && STEPS.includes(requestedStep) ? requestedStep : "account"
	);

	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const [accountType, setAccountType] = useState<AccountType>("patient");
	const [plan, setPlan] = useState<PlanId>("free");
	const [agreed, setAgreed] = useState(false);

	// Someone who already finished signup has no business here.
	useEffect(() => {
		if (!loading && isAuthenticated && user?.profile.onboardingCompletedAt) {
			navigate("/upload", { replace: true });
		}
	}, [loading, isAuthenticated, user, navigate]);

	// Arriving mid-flow (OAuth callback, or a refresh) without an account sends
	// you back to step 1.
	useEffect(() => {
		if (!loading && !isAuthenticated && step !== "account") setStep("account");
	}, [loading, isAuthenticated, step]);

	// Prefill from whatever the account already knows (OAuth arrivals especially).
	// The name comes off the user, not the profile mock — it has a real column.
	useEffect(() => {
		if (user) {
			setName((n) => n || (user.hasCustomName ? user.name : ""));
			setAccountType(user.profile.accountType);
			setPlan(user.profile.plan);
		}
	}, [user]);

	const stepIndex = STEPS.indexOf(step);

	const submitAccount = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		if (!name.trim()) { setError("Enter your name."); return; }
		if (!email.trim() || !password) { setError("Enter an email and password."); return; }
		if (password !== confirm) { setError("Passwords don't match."); return; }
		setBusy(true);
		try {
			await signUp(email, password, name);
			setStep("type");
		} catch (err) {
			setError(err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	};

	// The name was already sent to the server by signUp(); only the mock fields
	// are written here.
	const finish = () => {
		const now = new Date().toISOString();
		updateAccountProfile({
			accountType,
			plan,
			acceptedTermsAt: now,
			onboardingCompletedAt: now,
		});
		navigate("/upload", { replace: true });
	};

	return (
		<div className="signup-wrapper">
			<header className="signup-header">
				<Link to="/" className="signup-brand">
					<img src="/bodymaps-logo.svg" alt="" className="signup-logo" />
					<span>BodyMaps</span>
				</Link>
				{step === "account" && (
					<div className="signup-header-alt">
						Already have an account?{" "}
						<button
							type="button"
							className="signup-link"
							onClick={() => { navigate("/"); promptAuth(); }}
						>
							Sign in
						</button>
					</div>
				)}
			</header>

			<main className="signup-main">
				<div className="signup-panel">
					{/* Progress */}
					<ol className="signup-steps" aria-label="Progress">
						{STEPS.map((s, i) => (
							<li
								key={s}
								className={`signup-step${i === stepIndex ? " signup-step--current" : ""}${
									i < stepIndex ? " signup-step--done" : ""
								}`}
							>
								<span className="signup-step-dot">
									{i < stepIndex ? <IconCheck size={13} stroke={3} /> : i + 1}
								</span>
							</li>
						))}
					</ol>

					<h1 className="signup-title">{STEP_TITLES[step]}</h1>

					{/* ── Step 1: account ── */}
					{step === "account" && (
						<>
							<div className="signup-providers">
								<button
									type="button"
									className="signup-provider"
									disabled={oauthProviders?.google === false}
									title={oauthProviders?.google === false ? "Not configured on this server" : undefined}
									onClick={() => signInWithProvider("google")}
								>
									<IconBrandGoogle size={18} /> Sign up with Google
								</button>
								<button
									type="button"
									className="signup-provider"
									disabled={oauthProviders?.github === false}
									title={oauthProviders?.github === false ? "Not configured on this server" : undefined}
									onClick={() => signInWithProvider("github")}
								>
									<IconBrandGithub size={18} /> Sign up with GitHub
								</button>
							</div>

							<div className="signup-divider"><span>or</span></div>

							<form className="signup-form" onSubmit={submitAccount}>
								<label className="signup-field">
									<span className="signup-label">Name</span>
									<input
										className="signup-input" value={name} autoComplete="name"
										onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace"
									/>
								</label>
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
										onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
									/>
								</label>
								<label className="signup-field">
									<span className="signup-label">Confirm password</span>
									<input
										type="password" className="signup-input" value={confirm} autoComplete="new-password"
										onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••"
									/>
								</label>
								{error && <div className="signup-error">{error}</div>}
								<button type="submit" className="signup-primary" disabled={busy}>
									{busy ? "Creating account…" : "Continue"}
								</button>
							</form>
						</>
					)}

					{/* ── Step 2: account type ── */}
					{step === "type" && (
						<>
							<p className="signup-sub">
								This tailors what you see — the tools, the wording, and how results are
								presented. You can change it any time in account settings.
							</p>
							<div className="signup-choices">
								{ACCOUNT_TYPES.map((t) => (
									<button
										key={t.id}
										type="button"
										className={`signup-choice${accountType === t.id ? " signup-choice--on" : ""}`}
										aria-pressed={accountType === t.id}
										aria-label={t.label}
										onClick={() => setAccountType(t.id)}
									>
										<span className="signup-choice-label">{t.label}</span>
										<span className="signup-choice-blurb">{t.blurb}</span>
									</button>
								))}
							</div>
							<div className="signup-actions">
								<button type="button" className="signup-primary" onClick={() => setStep("plan")}>
									Continue
								</button>
							</div>
						</>
					)}

					{/* ── Step 3: plan ── */}
					{step === "plan" && (
						<>
							<p className="signup-sub">
								Pricing isn't set yet and nothing is charged — everything is available
								while BodyMaps is in development. Pick what fits how you'd use it.
							</p>
							<div className="signup-plans">
								{PLANS.map((p) => (
									<button
										key={p.id}
										type="button"
										className={`signup-plan${plan === p.id ? " signup-plan--on" : ""}`}
										aria-pressed={plan === p.id}
										aria-label={p.label}
										onClick={() => setPlan(p.id)}
									>
										<span className="signup-plan-name">{p.label}</span>
										<span className="signup-plan-tagline">{p.tagline}</span>
										<ul className="signup-plan-points">
											{p.points.map((pt) => (
												<li key={pt}><IconCheck size={13} stroke={2.5} /> {pt}</li>
											))}
										</ul>
									</button>
								))}
							</div>
							<p className="signup-note">
								Researcher or student? There's a free academic access lane — ask us once
								you're in.
							</p>
							<div className="signup-actions">
								<button type="button" className="signup-back" onClick={() => setStep("type")}>
									Back
								</button>
								<button type="button" className="signup-primary" onClick={() => setStep("terms")}>
									Continue
								</button>
							</div>
						</>
					)}

					{/* ── Step 4: terms ── */}
					{step === "terms" && (
						<>
							<p className="signup-sub">
								BodyMaps is research software. It does not provide a diagnosis, and its
								output is not a substitute for a qualified clinician's judgment.
							</p>
							<label className="signup-agree">
								<input
									type="checkbox"
									checked={agreed}
									onChange={(e) => setAgreed(e.target.checked)}
								/>
								<span>
									I agree to the <Link to="/terms" target="_blank">Terms of Service</Link> and{" "}
									<Link to="/privacy" target="_blank">Privacy Policy</Link>.
								</span>
							</label>
							<div className="signup-actions">
								<button type="button" className="signup-back" onClick={() => setStep("plan")}>
									Back
								</button>
								<button
									type="button"
									className="signup-primary"
									disabled={!agreed}
									onClick={finish}
								>
									Finish
								</button>
							</div>
						</>
					)}
				</div>
			</main>
		</div>
	);
};

export default SignupPage;

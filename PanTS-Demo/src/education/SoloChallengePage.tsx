import { IconArrowRight, IconClock, IconCrosshair, IconRulerMeasure, IconSparkles } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { API_BASE } from "../helpers/constants";
import VisualizationPage from "../routes/VisualizationPage";
import type { EducationAttempt, EducationChallenge, EducationResult, SoloChallengeController } from "./types";
import "./soloChallenge.css";

const CHALLENGE_ID = "pancreas-case-35";

async function responseJson<T>(response: Response): Promise<T> {
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
	return body as T;
}

export default function SoloChallengePage() {
	const { challengeId = CHALLENGE_ID } = useParams<{ challengeId: string }>();
	const [challenge, setChallenge] = useState<EducationChallenge | null>(null);
	const [attempt, setAttempt] = useState<EducationAttempt | null>(null);
	const [loading, setLoading] = useState(true);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [now, setNow] = useState(Date.now());
	const [findingChoice, setFindingChoice] = useState("");
	const [impression, setImpression] = useState("");
	const [marker, setMarker] = useState<[number, number, number] | null>(null);
	const [result, setResult] = useState<EducationResult | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [retryingGrade, setRetryingGrade] = useState(false);
	const [taskDockOpen, setTaskDockOpen] = useState(true);

	useEffect(() => {
		fetch(`${API_BASE}/api/education/challenges/${challengeId}`)
			.then((response) => responseJson<EducationChallenge>(response))
			.then(setChallenge)
			.catch((caught) => setError(caught instanceof Error ? caught.message : "Challenge unavailable"))
			.finally(() => setLoading(false));
	}, [challengeId]);

	useEffect(() => {
		if (!attempt || result) return;
		const timer = window.setInterval(() => setNow(Date.now()), 250);
		return () => window.clearInterval(timer);
	}, [attempt, result]);

	const remainingSeconds = useMemo(() => {
		if (!attempt) return challenge?.time_limit_seconds ?? 300;
		return Math.max(0, Math.ceil((new Date(attempt.deadline_at).getTime() - now) / 1000));
	}, [attempt, challenge?.time_limit_seconds, now]);

	const start = async () => {
		setStarting(true);
		setError(null);
		try {
			const response = await fetch(`${API_BASE}/api/education/challenges/${challengeId}/attempts`, { method: "POST" });
			setAttempt(await responseJson<EducationAttempt>(response));
			setNow(Date.now());
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not start challenge");
		} finally {
			setStarting(false);
		}
	};

	const submit = useCallback(async (measurement: Parameters<SoloChallengeController["submit"]>[0], timedOut = false) => {
		if (!attempt || result || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const fallbackImpression = "No impression was submitted before the time limit expired.";
			const response = await fetch(`${API_BASE}/api/education/attempts/${attempt.attempt_id}/submit`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Attempt-Key": attempt.attempt_key },
				body: JSON.stringify({
					finding_choice: findingChoice || "no_focal_lesion",
					marker_lps: marker,
					measurement: measurement ? { points: measurement.points } : null,
					impression: impression.trim() || (timedOut ? fallbackImpression : "No impression submitted."),
				}),
			});
			setResult(await responseJson<EducationResult>(response));
			setTaskDockOpen(true);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not submit challenge");
		} finally {
			setSubmitting(false);
		}
	}, [attempt, findingChoice, impression, marker, result, submitting]);

	const retryGrade = useCallback(async () => {
		if (!attempt || !result || result.status !== "provisional" || retryingGrade) return;
		setRetryingGrade(true);
		setError(null);
		try {
			const response = await fetch(`${API_BASE}/api/education/attempts/${attempt.attempt_id}/retry-grade`, {
				method: "POST",
				headers: { "X-Attempt-Key": attempt.attempt_key },
			});
			setResult(await responseJson<EducationResult>(response));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "AI grading remains unavailable");
		} finally {
			setRetryingGrade(false);
		}
	}, [attempt, result, retryingGrade]);

	if (loading) return <ChallengeState title="Loading challenge…" />;
	if (!challenge || error && !attempt) return <ChallengeState title="Challenge unavailable" detail={error ?? undefined} />;

	if (!attempt) {
		return (
			<main className="edu-start">
				<div className="edu-start__scan" aria-hidden="true" />
				<section className="edu-start__card">
					<span className="edu-kicker">{challenge.eyebrow}</span>
					<h1>{challenge.title}</h1>
					<p>{challenge.prompt}</p>
					<div className="edu-start__facts">
						<span><IconClock size={18} /> Five minutes</span>
						<span><IconCrosshair size={18} /> 3D localization</span>
						<span><IconRulerMeasure size={18} /> Axial diameter</span>
						<span><IconSparkles size={18} /> Post-submit AI tutor</span>
					</div>
					<ol>{challenge.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ol>
					<div className="edu-start__notice">The answer overlay and BodyMaps AI stay locked until submission. This is a low-stakes educational exercise, not clinical diagnosis.</div>
					{error && <div className="edu-error" role="alert">{error}</div>}
					<button type="button" onClick={() => void start()} disabled={starting}>
						{starting ? "Preparing case…" : "Start solo challenge"} <IconArrowRight size={19} />
					</button>
				</section>
			</main>
		);
	}

	const controller: SoloChallengeController = {
		challenge,
		attempt,
		remainingSeconds,
		findingChoice,
		setFindingChoice,
		impression,
		setImpression,
		marker,
		setMarker,
		result,
		submitting,
		retryingGrade,
		error,
		submit,
		retryGrade,
		taskDockOpen,
		setTaskDockOpen,
	};
	return <VisualizationPage soloChallenge={controller} />;
}

function ChallengeState({ title, detail }: { title: string; detail?: string }) {
	return <main className="edu-start edu-start--state"><div><span className="edu-loading" /><h1>{title}</h1>{detail && <p>{detail}</p>}<a href="/case/35">Return to case 35</a></div></main>;
}

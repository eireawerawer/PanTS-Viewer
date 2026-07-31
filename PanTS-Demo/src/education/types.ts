import type { SharedMeasurement } from "../helpers/CornerstoneNifti2";

export type EducationFindingChoice = {
	id: string;
	label: string;
};

export type EducationChallenge = {
	challenge_id: string;
	case_id: string;
	title: string;
	eyebrow: string;
	prompt: string;
	time_limit_seconds: number;
	finding_choices: EducationFindingChoice[];
	requirements: string[];
	scoring: {
		localization: number;
		measurement: number;
		finding: number;
		impression: number;
		time: "tie_break";
	};
};

export type EducationAttempt = {
	attempt_id: string;
	attempt_key: string;
	challenge_id: string;
	started_at: string;
	deadline_at: string;
	delete_at: string;
	status: "active";
};

export type EducationScoreComponent = {
	points: number;
	max_points: number;
	[key: string]: unknown;
};

export type EducationResult = {
	attempt_id: string;
	challenge_id: string;
	status: "graded" | "provisional";
	submitted_at: string;
	elapsed_seconds: number;
	objective_points: number;
	total_points: number | null;
	max_points: number;
	scores: {
		localization: EducationScoreComponent & { distance_mm: number | null; inside_lesion: boolean };
		measurement: EducationScoreComponent & { measured_mm: number | null; reference_mm: number; error_percent: number | null };
		finding: EducationScoreComponent & { selected: string; correct: string };
	};
	ai_grade: {
		status: "graded" | "provisional";
		model: string;
		rubric_version: number;
		criteria: Record<"finding" | "location" | "evidence" | "impression", number> | null;
		points: number | null;
		max_points: number;
		feedback: string | null;
	};
	ground_truth: {
		correct_finding: string;
		correct_finding_label: string;
		location: string;
		reference_diameter_mm: number;
		reference_measurement_lps: number[][];
		teaching_points: string[];
	};
};

export type SoloChallengeController = {
	challenge: EducationChallenge;
	attempt: EducationAttempt;
	remainingSeconds: number;
	findingChoice: string;
	setFindingChoice: (value: string) => void;
	impression: string;
	setImpression: (value: string) => void;
	marker: [number, number, number] | null;
	setMarker: (value: [number, number, number] | null) => void;
	result: EducationResult | null;
	submitting: boolean;
	retryingGrade: boolean;
	error: string | null;
	submit: (measurement: SharedMeasurement | null, timedOut?: boolean) => Promise<void>;
	retryGrade: () => Promise<void>;
	taskDockOpen: boolean;
	setTaskDockOpen: (value: boolean) => void;
};

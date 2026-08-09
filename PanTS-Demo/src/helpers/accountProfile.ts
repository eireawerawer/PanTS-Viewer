// Plans, what each one allows, and the one remaining client-only profile field.
//
// PLAN_LIMITS mirrors flask-server/services/plan_store.py. The server is what
// actually decides — it returns 402 with a reason, and that reason is what the
// upgrade dialog reports. This copy exists so the UI can grey a locked control
// out up front instead of letting you click into a rejection. A drift between
// the two is a cosmetic bug here and a real one there; change them together.
//
// The plan itself is NOT stored here. It lives on user_account.plan and arrives
// through authContext. What's left in localStorage is `accountType`, which is
// self-reported, optional, and gates nothing.

export type AccountType = "patient" | "clinician" | "researcher" | "student";
export type PlanId = "free" | "pro" | "team" | "enterprise";
/** Which tab of the plan picker a plan appears under. */
export type PlanGroup = "individual" | "team";

/** null means unlimited, matching the server's representation. */
export type PlanLimits = {
	dailyScans: number | null;
	concurrentScans: number | null;
	/** Model ids the plan may run; null means every model. */
	models: string[] | null;
	postprocessing: boolean;
	dailyAiMessages: number | null;
	createReports: boolean;
	retentionDays: number | null;
	priorityQueue: boolean;
};

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
	free: {
		dailyScans: 3,
		concurrentScans: 1,
		models: ["LesionSegmenter"],
		postprocessing: false,
		dailyAiMessages: 10,
		createReports: false,
		retentionDays: 7,
		priorityQueue: false,
	},
	pro: {
		dailyScans: 50,
		concurrentScans: 5,
		models: null,
		postprocessing: true,
		dailyAiMessages: 200,
		createReports: true,
		retentionDays: 365,
		priorityQueue: true,
	},
	team: {
		dailyScans: 50,
		concurrentScans: 5,
		models: null,
		postprocessing: true,
		dailyAiMessages: 200,
		createReports: true,
		retentionDays: 365,
		priorityQueue: true,
	},
	enterprise: {
		dailyScans: null,
		concurrentScans: null,
		models: null,
		postprocessing: true,
		dailyAiMessages: null,
		createReports: true,
		retentionDays: null,
		priorityQueue: true,
	},
};

export const limitsFor = (plan: PlanId | undefined): PlanLimits =>
	PLAN_LIMITS[plan ?? "free"] ?? PLAN_LIMITS.free;

// Plan cards. Kept to a name, one line, a price, and a handful of short bullets
// — the shape Claude and ChatGPT both use. Longer copy was the old version's
// problem: four plans each explaining themselves in paragraphs is a wall, and
// nobody reads a wall to pick a tier.
export type Plan = {
	id: PlanId;
	label: string;
	group: PlanGroup;
	/** One line under the name. Six words is the budget. */
	blurb: string;
	/**
	 * The headline figure. Billing lands before launch; until it does, /me/plan
	 * is a column write and switching plans grants the tier immediately. The
	 * limits attached to a plan are enforced for real either way.
	 */
	price: string;
	/** Small print under the price ("per month"). */
	priceNote?: string;
	/** Small pill in the card's top corner (member counts), if any. */
	badge?: string;
	/** Renders "Everything in <that plan>, plus:" above the bullets. */
	inherits?: PlanId;
	/** Lead line above the bullets on a plan that inherits nothing. Present so
	 *  every card has one and the bullet lists line up across the row. */
	pointsLead?: string;
	/** Short noun phrases, not sentences. */
	points: string[];
	cta: string;
};

export const PLANS: Plan[] = [
	{
		id: "free",
		label: "Free",
		group: "individual",
		blurb: "Try BodyMaps",
		price: "$0",
		priceNote: "no donation needed",
		pointsLead: "Includes:",
		points: [
			"3 scans a day",
			"LesionSegmenter model",
			"Full viewer and 3D reconstruction",
			"10 assistant messages a day",
		],
		cta: "Start free",
	},
	{
		id: "pro",
		label: "Pro",
		group: "individual",
		blurb: "For everyday clinical and research work",
		price: "$1.99",
		priceNote: "monthly donation",
		inherits: "free",
		points: [
			"50 scans a day",
			"Every model",
			"5 scans at once",
			"Priority in the queue",
			"Create reports and annotations",
		],
		cta: "Donate for Pro",
	},
	{
		id: "team",
		label: "Team",
		group: "team",
		blurb: "For a practice or lab",
		price: "$4.99",
		priceNote: "monthly donation",
		badge: "2–15 members",
		inherits: "pro",
		// No "everything in Pro per member" bullet: the inherits line above the
		// list already says it.
		points: [
			"Shared case library",
			"Shared annotations and reports",
			"Usage pooled across the team",
			"One donation for the whole team",
		],
		cta: "Choose Team",
	},
	{
		id: "enterprise",
		label: "Enterprise",
		group: "team",
		blurb: "For a hospital or institution",
		// "Talk to us" is the button; the price slot needs to say something else.
		price: "Custom",
		priceNote: "donation by agreement",
		badge: "15+ members",
		inherits: "team",
		points: [
			"Single sign-on",
			"Signed BAA and DPA",
			"On-premise processing",
			"Access audit log",
			"Retention set to your policy",
			"PACS integration",
		],
		cta: "Talk to us",
	},
];

export const planLabel = (id: PlanId): string =>
	PLANS.find((p) => p.id === id)?.label ?? id;

/** The plan an upgrade prompt should point at. Enterprise has nowhere to go. */
export const nextPlanUp = (plan: PlanId): PlanId | null =>
	plan === "free" ? "pro" : plan === "pro" ? "team" : plan === "team" ? "enterprise" : null;

// ---- feature checks --------------------------------------------------------
// Cosmetic only — each has a server-side counterpart that does the real work.

/** Whether a model id is outside the plan's allowance. "None" is view-only and
 *  never reaches the server, so it's never locked. */
export const isModelLocked = (plan: PlanId, modelId: string): boolean => {
	if (modelId === "None") return false;
	const allowed = limitsFor(plan).models;
	return allowed !== null && !allowed.includes(modelId);
};

export const canPostprocess = (plan: PlanId): boolean => limitsFor(plan).postprocessing;

export const canCreateReports = (plan: PlanId): boolean => limitsFor(plan).createReports;

/** How many scans this plan may have running at once (Infinity if unlimited). */
export const maxConcurrentScans = (plan: PlanId): number =>
	limitsFor(plan).concurrentScans ?? Infinity;

// ---- account type (self-reported, optional, gates nothing) -----------------

export const ACCOUNT_TYPES: { id: AccountType; label: string }[] = [
	{ id: "patient", label: "Patient" },
	{ id: "clinician", label: "Clinician" },
	{ id: "researcher", label: "Researcher" },
	{ id: "student", label: "Student" },
];

export const accountTypeLabel = (id: AccountType | null): string =>
	ACCOUNT_TYPES.find((t) => t.id === id)?.label ?? "Not set";

export type AccountProfile = {
	/** null until the user picks one in settings. Nothing depends on it. */
	accountType: AccountType | null;
};

export const DEFAULT_PROFILE: AccountProfile = { accountType: null };

export const PROFILE_KEY_PREFIX = "accountProfile:";

const profileKey = (userId: string) => `${PROFILE_KEY_PREFIX}${userId}`;

export const loadProfile = (userId: string): AccountProfile | null => {
	try {
		const raw = localStorage.getItem(profileKey(userId));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		// Merge over defaults so a profile written by an older build still loads.
		// Older builds also wrote plan/onboarding keys here; they're ignored now
		// that the plan is a server column, and dropped on the next write.
		return { accountType: parsed.accountType ?? null };
	} catch {
		return null;
	}
};

export const persistProfile = (userId: string, profile: AccountProfile) => {
	try {
		localStorage.setItem(profileKey(userId), JSON.stringify(profile));
	} catch (e) {
		console.warn("persistProfile failed", e);
	}
};

export const updateProfile = (
	userId: string,
	patch: Partial<AccountProfile>
): AccountProfile => {
	const next = { ...(loadProfile(userId) ?? DEFAULT_PROFILE), ...patch };
	persistProfile(userId, next);
	return next;
};

export const clearProfile = (userId: string) => {
	try {
		localStorage.removeItem(profileKey(userId));
	} catch (e) {
		console.warn("clearProfile failed", e);
	}
};

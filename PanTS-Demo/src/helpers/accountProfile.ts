// Account profile: account type, plan, and onboarding state.
//
// MOCK — everything here lives in localStorage, keyed by user id. Nothing is
// enforced: no feature is gated by plan or type, no quota is counted, no queue
// priority is applied. This is the shape the signup flow collects so the UI can
// be built and reacted to before any of it is made real.
//
// Deliberately NOT here: the display name and account deletion. Both have real
// server-side homes (user_account.name, user_account.deletion_requested_at) and
// go through authContext's updateName / deleteAccount. Mirroring them here too
// would give each two sources of truth that drift the moment one is written
// without the other.
//
// This file is the single seam for what remains. When the backend grows
// `account_type` and `plan` columns, only load/persist below change — every
// caller reads through authContext, which reads through here.
//
// Follows the helpers/recentUploads.ts pattern (typed shape, try/catch around
// every storage access, pure functions so it can be unit-tested).

export type AccountType = "patient" | "clinician" | "researcher" | "student";
export type PlanId = "free" | "pro" | "team" | "enterprise";

export type AccountProfile = {
	accountType: AccountType;
	plan: PlanId;
	/** ISO timestamp of terms acceptance; null until the signup flow's last step. */
	acceptedTermsAt: string | null;
	/** ISO timestamp; null means signup was never finished (drives OAuth onboarding). */
	onboardingCompletedAt: string | null;
};

export const PROFILE_KEY_PREFIX = "accountProfile:";

const profileKey = (userId: string) => `${PROFILE_KEY_PREFIX}${userId}`;

export const ACCOUNT_TYPES: { id: AccountType; label: string; blurb: string }[] = [
	{
		id: "patient",
		label: "Patient",
		blurb: "Understand your own scan in plain language.",
	},
	{
		id: "clinician",
		label: "Clinician",
		blurb: "Read scans for patients, with the full measurement toolset.",
	},
	{
		id: "researcher",
		label: "Researcher",
		blurb: "Run cohorts and export structured results in bulk.",
	},
	{
		id: "student",
		label: "Student or trainee",
		blurb: "Learn anatomy against the public PanTS dataset.",
	},
];

// No prices yet — deliberately. These describe who each plan is for, which is
// the part worth settling before anyone picks a number.
export const PLANS: { id: PlanId; label: string; tagline: string; points: string[] }[] = [
	{
		id: "free",
		label: "Free",
		tagline: "For a single scan, or to try things out.",
		points: [
			"A few scans per month",
			"Full viewer and 3D reconstruction",
			"Standard queue",
			"Results kept short-term",
		],
	},
	{
		id: "pro",
		label: "Pro",
		tagline: "For one clinician or researcher working seriously.",
		points: [
			"Room for regular use",
			"Priority in the inference queue",
			"Several scans processing at once",
			"Specialized models",
			"Long-term result retention",
		],
	},
	{
		id: "team",
		label: "Team",
		tagline: "For a practice or research group working together.",
		points: [
			"Everything in Pro, per seat",
			"Shared case library and annotations",
			"Pooled quota across the team",
			"Roles and an audit log",
		],
	},
	{
		id: "enterprise",
		label: "Enterprise",
		tagline: "For a hospital or institution.",
		points: [
			"Single sign-on",
			"Dedicated or on-premise compute",
			"Custom retention, DPA and BAA",
			"API access and support commitments",
		],
	},
];

export const DEFAULT_PROFILE: AccountProfile = {
	accountType: "patient",
	plan: "free",
	acceptedTermsAt: null,
	onboardingCompletedAt: null,
};

export const loadProfile = (userId: string): AccountProfile | null => {
	try {
		const raw = localStorage.getItem(profileKey(userId));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		// Merge over defaults so a profile written by an older build (missing a
		// field added later) still loads instead of throwing.
		return { ...DEFAULT_PROFILE, ...parsed };
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

/**
 * Whether to send this user through the account-type/plan/terms steps.
 *
 * MOCK LIMITATION: "needs onboarding" really means "no profile in *this
 * browser's* localStorage", so an OAuth user returning on a new device is asked
 * again. The real fix is a user_account.onboarding_completed_at column returned
 * by /api/auth/me — this function is the one place that changes when it lands.
 */
export const needsOnboarding = (userId: string): boolean =>
	loadProfile(userId)?.onboardingCompletedAt == null;

export const planLabel = (id: PlanId): string =>
	PLANS.find((p) => p.id === id)?.label ?? id;

export const accountTypeLabel = (id: AccountType): string =>
	ACCOUNT_TYPES.find((t) => t.id === id)?.label ?? id;

import { beforeEach, describe, expect, it } from "vitest";
import {
	canPostprocess,
	clearProfile,
	DEFAULT_PROFILE,
	isModelLocked,
	limitsFor,
	loadProfile,
	maxConcurrentScans,
	nextPlanUp,
	persistProfile,
	PLAN_LIMITS,
	PLANS,
	PROFILE_KEY_PREFIX,
	updateProfile,
} from "./accountProfile";

const USER = "user-1";

beforeEach(() => {
	localStorage.clear();
});

describe("plan limits", () => {
	it("gives Free only the free model", () => {
		expect(PLAN_LIMITS.free.models).toEqual(["LesionSegmenter"]);
		expect(isModelLocked("free", "LesionSegmenter")).toBe(false);
		expect(isModelLocked("free", "ePAI")).toBe(true);
		expect(isModelLocked("free", "R-Super")).toBe(true);
	});

	it("never locks the view-only option — it doesn't reach the server", () => {
		expect(isModelLocked("free", "None")).toBe(false);
	});

	it("unlocks every model above Free", () => {
		for (const plan of ["pro", "team", "enterprise"] as const) {
			expect(isModelLocked(plan, "ePAI")).toBe(false);
			expect(canPostprocess(plan)).toBe(true);
		}
	});

	it("holds postprocessing back from Free", () => {
		expect(canPostprocess("free")).toBe(false);
	});

	it("reports concurrency as a number, unlimited included", () => {
		expect(maxConcurrentScans("free")).toBe(1);
		expect(maxConcurrentScans("pro")).toBe(5);
		expect(maxConcurrentScans("enterprise")).toBe(Infinity);
	});

	it("falls back to Free for an unknown plan rather than throwing", () => {
		// @ts-expect-error deliberately outside PlanId — a stale value from the API
		expect(limitsFor("platinum")).toEqual(PLAN_LIMITS.free);
		expect(limitsFor(undefined)).toEqual(PLAN_LIMITS.free);
	});

	it("points each plan at the next one up, and Enterprise at nothing", () => {
		expect(nextPlanUp("free")).toBe("pro");
		expect(nextPlanUp("pro")).toBe("team");
		expect(nextPlanUp("team")).toBe("enterprise");
		expect(nextPlanUp("enterprise")).toBeNull();
	});
});

describe("plan cards", () => {
	it("splits into two individual and two team plans", () => {
		expect(PLANS.filter((p) => p.group === "individual").map((p) => p.id))
			.toEqual(["free", "pro"]);
		expect(PLANS.filter((p) => p.group === "team").map((p) => p.id))
			.toEqual(["team", "enterprise"]);
	});

	it("keeps every card short enough to scan", () => {
		for (const plan of PLANS) {
			expect(plan.points.length).toBeLessThanOrEqual(6);
			// Bullets are noun phrases, not sentences.
			for (const point of plan.points) {
				expect(point.split(" ").length).toBeLessThanOrEqual(6);
				expect(point).not.toMatch(/\.$/);
			}
			expect(plan.blurb.split(" ").length).toBeLessThanOrEqual(7);
		}
	});

	it("quotes no prices — none have been set", () => {
		const text = JSON.stringify(PLANS);
		expect(text).not.toMatch(/[$£€]\s?\d/);
		expect(text).not.toMatch(/per month|\/mo\b/i);
	});

	it("has a limits entry for every card and vice versa", () => {
		expect(PLANS.map((p) => p.id).sort()).toEqual(Object.keys(PLAN_LIMITS).sort());
	});
});

describe("loadProfile", () => {
	it("returns null when the user has no stored profile", () => {
		expect(loadProfile(USER)).toBeNull();
	});

	it("returns null when storage holds malformed JSON", () => {
		localStorage.setItem(`${PROFILE_KEY_PREFIX}${USER}`, "{not json");
		expect(loadProfile(USER)).toBeNull();
	});

	it("ignores plan and onboarding keys left by an older build", () => {
		// Both moved server-side; a stale local copy must not resurface.
		localStorage.setItem(
			`${PROFILE_KEY_PREFIX}${USER}`,
			JSON.stringify({ plan: "enterprise", onboardingCompletedAt: "2026-01-01", accountType: "clinician" })
		);
		expect(loadProfile(USER)).toEqual({ accountType: "clinician" });
	});

	it("keeps profiles for different users separate", () => {
		persistProfile(USER, { accountType: "clinician" });
		persistProfile("user-2", { accountType: "researcher" });
		expect(loadProfile(USER)?.accountType).toBe("clinician");
		expect(loadProfile("user-2")?.accountType).toBe("researcher");
	});
});

describe("updateProfile", () => {
	it("starts from the defaults when nothing is stored yet", () => {
		expect(updateProfile(USER, { accountType: "clinician" })).toEqual({
			...DEFAULT_PROFILE,
			accountType: "clinician",
		});
	});

	it("persists across a reload", () => {
		updateProfile(USER, { accountType: "researcher" });
		expect(loadProfile(USER)?.accountType).toBe("researcher");
	});

	it("can clear the account type back to unset", () => {
		updateProfile(USER, { accountType: "student" });
		expect(updateProfile(USER, { accountType: null }).accountType).toBeNull();
	});
});

describe("clearProfile", () => {
	it("removes only the target user's profile", () => {
		persistProfile(USER, { accountType: "clinician" });
		persistProfile("user-2", { accountType: "researcher" });
		clearProfile(USER);
		expect(loadProfile(USER)).toBeNull();
		expect(loadProfile("user-2")?.accountType).toBe("researcher");
	});
});

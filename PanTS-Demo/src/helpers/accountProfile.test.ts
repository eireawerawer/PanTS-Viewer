import { beforeEach, describe, expect, it } from "vitest";
import {
	clearProfile,
	DEFAULT_PROFILE,
	loadProfile,
	needsOnboarding,
	persistProfile,
	PROFILE_KEY_PREFIX,
	updateProfile,
} from "./accountProfile";

const USER = "user-1";

beforeEach(() => {
	localStorage.clear();
});

describe("loadProfile", () => {
	it("returns null when the user has no stored profile", () => {
		expect(loadProfile(USER)).toBeNull();
	});

	it("returns null when storage holds malformed JSON", () => {
		localStorage.setItem(`${PROFILE_KEY_PREFIX}${USER}`, "{not json");
		expect(loadProfile(USER)).toBeNull();
	});

	it("fills in fields missing from a profile written by an older build", () => {
		localStorage.setItem(
			`${PROFILE_KEY_PREFIX}${USER}`,
			JSON.stringify({ plan: "pro" })
		);
		expect(loadProfile(USER)).toEqual({ ...DEFAULT_PROFILE, plan: "pro" });
	});

	it("keeps profiles for different users separate", () => {
		persistProfile(USER, { ...DEFAULT_PROFILE, plan: "pro" });
		persistProfile("user-2", { ...DEFAULT_PROFILE, plan: "team" });
		expect(loadProfile(USER)?.plan).toBe("pro");
		expect(loadProfile("user-2")?.plan).toBe("team");
	});
});

describe("updateProfile", () => {
	it("starts from the defaults when nothing is stored yet", () => {
		expect(updateProfile(USER, { accountType: "clinician" })).toEqual({
			...DEFAULT_PROFILE,
			accountType: "clinician",
		});
	});

	it("merges into the existing profile rather than replacing it", () => {
		updateProfile(USER, { plan: "pro" });
		const next = updateProfile(USER, { accountType: "researcher" });
		expect(next).toMatchObject({ plan: "pro", accountType: "researcher" });
	});

	it("persists across a reload", () => {
		updateProfile(USER, { plan: "enterprise" });
		expect(loadProfile(USER)?.plan).toBe("enterprise");
	});
});

describe("clearProfile", () => {
	it("removes only the target user's profile", () => {
		persistProfile(USER, { ...DEFAULT_PROFILE, plan: "pro" });
		persistProfile("user-2", { ...DEFAULT_PROFILE, plan: "team" });
		clearProfile(USER);
		expect(loadProfile(USER)).toBeNull();
		expect(loadProfile("user-2")?.plan).toBe("team");
	});
});

describe("needsOnboarding", () => {
	it("is true for a user with no profile at all", () => {
		expect(needsOnboarding(USER)).toBe(true);
	});

	it("stays true while onboarding is only partly done", () => {
		updateProfile(USER, { accountType: "clinician", plan: "pro" });
		expect(needsOnboarding(USER)).toBe(true);
	});

	it("is false once onboarding is marked complete", () => {
		updateProfile(USER, { onboardingCompletedAt: new Date().toISOString() });
		expect(needsOnboarding(USER)).toBe(false);
	});
});

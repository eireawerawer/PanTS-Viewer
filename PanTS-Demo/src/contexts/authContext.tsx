// Real authentication against the Flask backend (B1: email/password).
//
// The session lives in an httponly cookie the JS can't read, so on mount we ask
// GET /api/auth/me to restore it; sign in/up/out hit the auth endpoints. Every
// request uses credentials:"include" so the cookie is sent (also cross-origin in
// dev). This is the single seam the whole account UI reads through.
//
// Not wired yet (backend phases still to come):
//   - signInWithProvider (Google/GitHub) -> B2 OAuth. Rejects for now; the modal
//     shows the buttons disabled.
//   - emailNotifications -> B3. Kept as a client-only preference in localStorage.
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { API_BASE } from "../helpers/constants";

export type AuthUser = {
	id: string;
	email: string;
	name: string; // derived from the email until the backend stores a name
	emailNotifications: boolean; // client-only preference until B3
};

export type AuthProvider2 = "google" | "github";

type AuthContextValue = {
	user: AuthUser | null;
	isAuthenticated: boolean;
	/** True until the initial /me check resolves (avoids a signed-out flash). */
	loading: boolean;
	signIn: (email: string, password: string) => Promise<AuthUser>;
	signUp: (email: string, password: string) => Promise<AuthUser>;
	signInWithProvider: (provider: AuthProvider2) => Promise<AuthUser>;
	signOut: () => Promise<void>;
	updatePreferences: (patch: Partial<Pick<AuthUser, "emailNotifications">>) => void;
	// Global auth popup, opened from the header or any gated action.
	authPrompt: { open: boolean; mode: "signin" | "signup" };
	promptAuth: (mode?: "signin" | "signup") => void;
	closeAuthPrompt: () => void;
};

// Cross-tab sync: writing this key on any auth change nudges other tabs to
// re-check /me (we can't watch the httponly cookie directly).
const AUTH_PING_KEY = "authChangePing";

const nameFromEmail = (email: string): string => {
	const local = email.split("@")[0] || email;
	return (
		local
			.split(/[._-]+/)
			.filter(Boolean)
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join(" ") || email
	);
};

// Email-notification preference is client-only until the backend supports it.
const prefKey = (id: string) => `emailNotif:${id}`;
const loadPref = (id: string): boolean => {
	try {
		const v = localStorage.getItem(prefKey(id));
		return v === null ? true : v === "1";
	} catch {
		return true;
	}
};
const savePref = (id: string, on: boolean) => {
	try {
		localStorage.setItem(prefKey(id), on ? "1" : "0");
	} catch {
		/* ignore */
	}
};

type ApiUser = { id: string; email: string };
const mapApiUser = (u: ApiUser): AuthUser => ({
	id: u.id,
	email: u.email,
	name: nameFromEmail(u.email),
	emailNotifications: loadPref(u.id),
});

const authFetch = (path: string, init?: RequestInit) =>
	fetch(`${API_BASE}${path}`, {
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		...init,
	});

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [loading, setLoading] = useState(true);
	const [authPrompt, setAuthPrompt] = useState<{ open: boolean; mode: "signin" | "signup" }>({
		open: false,
		mode: "signin",
	});

	const refreshMe = useCallback(async () => {
		try {
			const res = await authFetch("/api/auth/me");
			if (res.ok) {
				const { user: u } = await res.json();
				setUser(u ? mapApiUser(u) : null);
			} else {
				setUser(null);
			}
		} catch {
			setUser(null); // network error -> treat as signed out
		} finally {
			setLoading(false);
		}
	}, []);

	// Restore the session from the cookie on mount.
	useEffect(() => {
		refreshMe();
	}, [refreshMe]);

	// Cross-tab: another tab signed in/out -> re-check.
	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key === AUTH_PING_KEY) refreshMe();
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [refreshMe]);

	const pingOtherTabs = () => {
		try {
			localStorage.setItem(AUTH_PING_KEY, String(Date.now()));
		} catch {
			/* ignore */
		}
	};

	const authAction = useCallback(async (path: string, email: string, password: string) => {
		const res = await authFetch(path, { method: "POST", body: JSON.stringify({ email, password }) });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
		const mapped = mapApiUser(data.user);
		setUser(mapped);
		pingOtherTabs();
		return mapped;
	}, []);

	const signIn = useCallback(
		(email: string, password: string) => authAction("/api/auth/login", email, password),
		[authAction]
	);
	const signUp = useCallback(
		(email: string, password: string) => authAction("/api/auth/register", email, password),
		[authAction]
	);

	// B2 (OAuth) not implemented server-side yet.
	const signInWithProvider = useCallback(async (_provider: AuthProvider2): Promise<AuthUser> => {
		throw new Error("Social sign-in isn't available yet.");
	}, []);

	const signOut = useCallback(async () => {
		// Clear locally first so the UI updates instantly, then revoke server-side.
		setUser(null);
		pingOtherTabs();
		try {
			await authFetch("/api/auth/logout", { method: "POST" });
		} catch {
			/* ignore — already cleared locally */
		}
	}, []);

	const promptAuth = useCallback((mode: "signin" | "signup" = "signin") => {
		setAuthPrompt({ open: true, mode });
	}, []);
	const closeAuthPrompt = useCallback(() => {
		setAuthPrompt((p) => ({ ...p, open: false }));
	}, []);

	// Auto-close the popup once a user is established.
	useEffect(() => {
		if (user) setAuthPrompt((p) => (p.open ? { ...p, open: false } : p));
	}, [user]);

	const updatePreferences = useCallback(
		(patch: Partial<Pick<AuthUser, "emailNotifications">>) => {
			setUser((prev) => {
				if (!prev) return prev;
				const next = { ...prev, ...patch };
				if (typeof next.emailNotifications === "boolean") savePref(next.id, next.emailNotifications);
				return next;
			});
		},
		[]
	);

	const value = useMemo<AuthContextValue>(
		() => ({
			user,
			isAuthenticated: user !== null,
			loading,
			signIn,
			signUp,
			signInWithProvider,
			signOut,
			updatePreferences,
			authPrompt,
			promptAuth,
			closeAuthPrompt,
		}),
		[user, loading, signIn, signUp, signInWithProvider, signOut, updatePreferences, authPrompt, promptAuth, closeAuthPrompt]
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
	return ctx;
}

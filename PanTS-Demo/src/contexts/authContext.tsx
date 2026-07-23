// MOCK authentication. No backend: any email/password "works", and the signed-in
// user is persisted to localStorage so the state survives reloads. This is the
// single seam the whole account feature reads through — when real auth lands,
// only signIn/signOut/loadUser here change (call the API, store a real token),
// and every consumer (AuthButton, LoginPage, AccountPage, UploadPage) stays put.
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export type AuthUser = {
	email: string;
	name: string;
	// Mock preferences that a real account would persist server-side.
	emailNotifications: boolean;
};

export type AuthProvider2 = "google" | "github";

type AuthContextValue = {
	user: AuthUser | null;
	isAuthenticated: boolean;
	signIn: (email: string, password: string) => Promise<AuthUser>;
	signUp: (email: string, password: string) => Promise<AuthUser>;
	signInWithProvider: (provider: AuthProvider2) => Promise<AuthUser>;
	signOut: () => void;
	updatePreferences: (patch: Partial<Pick<AuthUser, "emailNotifications">>) => void;
	// Global auth popup, opened from the header or any gated action.
	authPrompt: { open: boolean; mode: "signin" | "signup" };
	promptAuth: (mode?: "signin" | "signup") => void;
	closeAuthPrompt: () => void;
};

const STORAGE_KEY = "mockAuthUser";

const loadUser = (): AuthUser | null => {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.email === "string") {
			return {
				email: parsed.email,
				name: typeof parsed.name === "string" ? parsed.name : parsed.email.split("@")[0],
				emailNotifications: Boolean(parsed.emailNotifications),
			};
		}
	} catch {
		/* corrupt/unavailable storage — treat as signed out */
	}
	return null;
};

const persist = (user: AuthUser | null) => {
	try {
		if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* ignore quota/availability errors in the mock */
	}
};

// Derive a friendly display name from an email local-part ("jane.doe" -> "Jane Doe").
const nameFromEmail = (email: string): string => {
	const local = email.split("@")[0] || email;
	return local
		.split(/[._-]+/)
		.filter(Boolean)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join(" ") || email;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<AuthUser | null>(() => loadUser());
	const [authPrompt, setAuthPrompt] = useState<{ open: boolean; mode: "signin" | "signup" }>({
		open: false,
		mode: "signin",
	});

	// Keep other tabs in sync: a sign-in/out in one tab updates the rest.
	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key === STORAGE_KEY) setUser(loadUser());
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const establish = useCallback((email: string): AuthUser => {
		const next: AuthUser = {
			email: email.trim(),
			name: nameFromEmail(email.trim()),
			emailNotifications: true, // mock default: on
		};
		setUser(next);
		persist(next);
		return next;
	}, []);

	// signIn / signUp are identical in the mock (any credentials accepted); they
	// stay separate so the real implementation can diverge without touching callers.
	const signIn = useCallback(
		async (email: string, _password: string) => establish(email),
		[establish]
	);
	const signUp = useCallback(
		async (email: string, _password: string) => establish(email),
		[establish]
	);

	// Mock OAuth: no real provider round-trip, just establishes a demo user with a
	// provider-flavoured email. Swap for a real OAuth redirect later.
	const signInWithProvider = useCallback(
		async (provider: AuthProvider2) =>
			establish(provider === "google" ? "you@gmail.com" : "you@users.noreply.github.com"),
		[establish]
	);

	const signOut = useCallback(() => {
		setUser(null);
		persist(null);
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
				persist(next);
				return next;
			});
		},
		[]
	);

	const value = useMemo<AuthContextValue>(
		() => ({
			user,
			isAuthenticated: user !== null,
			signIn,
			signUp,
			signInWithProvider,
			signOut,
			updatePreferences,
			authPrompt,
			promptAuth,
			closeAuthPrompt,
		}),
		[user, signIn, signUp, signInWithProvider, signOut, updatePreferences, authPrompt, promptAuth, closeAuthPrompt]
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
	return ctx;
}

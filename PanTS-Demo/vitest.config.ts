import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Test-only config. Kept separate from vite.config.ts so the production build
// (tailwind/wasm plugins, dev proxy) is untouched. Heavy native modules
// (cornerstone, niivue) are mocked per-test rather than loaded here.
export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: false,
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		css: false,
	},
});

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The internal analytics dashboard. Separate app, same repo, deliberately not
// part of any deploy — see README.md.
export default defineConfig({
	plugins: [react()],
	server: {
		// Fixed: the Flask CORS allowlist names this origin in dev.
		port: 5174,
		strictPort: true,
		fs: {
			// This app imports the main site's Settings stylesheet directly rather
			// than keeping a second copy of it, so Vite has to be allowed to read
			// one level up.
			allow: [".."],
		},
	},
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import { defineConfig } from "vite";

import path from 'path';

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		https: {
			key: fs.readFileSync(path.resolve(__dirname, '../certs/localhost-key.pem')),
			cert: fs.readFileSync(path.resolve(__dirname, '../certs/localhost-cert.pem')),
		},
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
		},
		proxy: {
			"/api": {
				target: "https://localhost:5001",
				changeOrigin: true,
				secure: false,
			},
		},
	},
});

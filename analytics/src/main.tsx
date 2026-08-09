import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// The main site's settings chrome, imported rather than reimplemented: panels,
// rows, headings, buttons and inputs all come from there, so this dashboard
// follows the product's look automatically when it changes.
import "../../PanTS-Demo/src/routes/Settings/Settings.css";
import "./dashboard.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>
);

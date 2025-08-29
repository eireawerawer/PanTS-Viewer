import { BrowserRouter, Route, Routes } from "react-router";
import "./App.css";
import { AnnotationProvider } from "./contexts/annotationContexts";
import { FileProvider } from "./contexts/fileContexts";
import DataPage from "./routes/DataPage";
import Homepage from "./routes/Homepage";
import VisualizationPage from "./routes/VisualizationPage";

const BASENAME = import.meta.env.VITE_BASENAME;

function App() {
	return (
		<>
			<FileProvider>
				<AnnotationProvider>
				<div className="App">
					<BrowserRouter basename={BASENAME}>
						<Routes>
							<Route path="/" element={<Homepage />} />
							<Route path="/data" element={<DataPage />} />
							{/* <Route path="/:type/:page" element={<Homepage />} /> */}
							<Route path="/case/:caseId" element={<VisualizationPage />} />
						</Routes>
					</BrowserRouter>
				</div>
				</AnnotationProvider>
			</FileProvider>
		</>
	);
}	

export default App;

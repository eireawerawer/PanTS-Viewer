import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./App.css";
import AuthModal from "./components/AuthModal";
import { AnnotationProvider } from "./contexts/annotationContexts";
import { AuthProvider } from "./contexts/authContext";
import { FileProvider } from "./contexts/fileContexts";
import LandingPage from "./routes/LandingPage";
import ComparePage from "./routes/ComparePage";
import Homepage from "./routes/Homepage";
import TeamPage from "./routes/TeamPage/index";
import ScrollToTopButton from "./components/ScrollToTopButton";

// The viewer routes pull in the WebGL stack (NiiVue + Cornerstone + three.js), which
// is the bulk of the JS bundle. Code-split them so the landing + dataset pages don't
// download the viewer up front — they only load it when a case is actually opened.
const VisualizationPage = lazy(() => import("./routes/VisualizationPage"));
const CompareViewerPage = lazy(() => import("./routes/CompareViewerPage"));
const UploadPage = lazy(() => import("./routes/UploadPage"));
const LiveRoomPage = lazy(() => import("./liveRooms/LiveRoomPage"));
const SoloChallengePage = lazy(() => import("./education/SoloChallengePage"));
const QuizPracticePage = lazy(() => import("./education/QuizPracticePage"));
const AccountPage = lazy(() => import("./routes/AccountPage"));
const RotatingHeartLoader = lazy(() => import("./components/Loading"));

const BASENAME = import.meta.env.VITE_BASENAME;

// Lightweight fallback shown while a lazy route chunk loads (intentionally avoids the
// three.js loader so the fallback itself stays out of the main bundle).
function RouteFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#08090b",
      }}
    >
      <div
        className="animate-spin"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "2px solid rgba(255,255,255,0.15)",
          borderTopColor: "rgba(255,255,255,0.6)",
        }}
      />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <FileProvider>
        <AnnotationProvider>
          <div className="App">
            <BrowserRouter basename={BASENAME}>
              <ScrollToTopButton />
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route
                    path="/home.html"
                    element={<Navigate to="/" replace />}
                  />
                  <Route path="/dashboard" element={<Homepage />} />
                  <Route path="/case/:caseId" element={<VisualizationPage />} />
                  <Route path="/live/:roomId" element={<LiveRoomPage />} />
                  <Route path="/live/challenge/:challengeId" element={<SoloChallengePage />} />
                  <Route path="/learn/quiz/:packId" element={<QuizPracticePage />} />
                  <Route
                    path="/session/:sessionId"
                    element={<VisualizationPage />}
                  />
                  {/* Local DICOM series picked on the Upload page (files held in memory). */}
                  <Route path="/dicom" element={<VisualizationPage />} />
                  {/* Local NIfTI picked on the Upload page (file held in memory). */}
                  <Route path="/local-nifti" element={<VisualizationPage />} />
                  <Route
                    path="/reconstruction/:reconstructionId"
                    element={<VisualizationPage />}
                  />
                  <Route path="/test" element={<RotatingHeartLoader />} />
                  <Route path="/upload" element={<UploadPage />} />
                  {/* Sign in/up is a popup, so old /login links just land on home. */}
                  <Route path="/login" element={<Navigate to="/" replace />} />
                  <Route path="/account" element={<AccountPage />} />
                  <Route
                    path="/api"
                    element={<Navigate to="/upload" replace />}
                  />
                  <Route path="/team" element={<TeamPage />} />
                  <Route path="/compare" element={<ComparePage />} />
                  <Route
                    path="/compare-viewer"
                    element={<CompareViewerPage />}
                  />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </div>
          {/* Global sign-in / sign-up popup, above all routes. */}
          <AuthModal />
        </AnnotationProvider>
      </FileProvider>
    </AuthProvider>
  );
}

export default App;

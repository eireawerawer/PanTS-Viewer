import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import "./App.css";
import AuthModal from "./components/AuthModal";
import { AnnotationProvider } from "./contexts/annotationContexts";
import { AuthProvider, useAuth } from "./contexts/authContext";
import { needsOnboarding } from "./helpers/accountProfile";
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
const AccountPage = lazy(() => import("./routes/AccountPage"));
const SignupPage = lazy(() => import("./routes/SignupPage"));
const LegalPage = lazy(() => import("./routes/LegalPage"));
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

// Routes that must stay reachable while onboarding is incomplete — otherwise the
// gate below would bounce the signup flow off its own page.
const ONBOARDING_EXEMPT = ["/signup", "/terms", "/privacy"];

// Sends a signed-in user who never finished signup into the account-type / plan /
// terms steps. This is what catches OAuth first-timers: the provider callback
// lands them back in the app with an account but no answers.
//
// MOCK LIMITATION: "never finished" is read from this browser's localStorage
// (helpers/accountProfile.needsOnboarding), so the same OAuth user on a new
// device is asked again. A user_account.onboarding_completed_at column returned
// by /api/auth/me is the real fix.
function OnboardingGate() {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !isAuthenticated || !user) return;
    if (ONBOARDING_EXEMPT.some((p) => location.pathname.startsWith(p))) return;
    if (needsOnboarding(user.id)) {
      navigate("/signup?step=type", { replace: true });
    }
  }, [loading, isAuthenticated, user, location.pathname, navigate]);

  return null;
}

function App() {
  return (
    <AuthProvider>
      <FileProvider>
        <AnnotationProvider>
          <div className="App">
            <BrowserRouter basename={BASENAME}>
              <ScrollToTopButton />
              <OnboardingGate />
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route
                    path="/home.html"
                    element={<Navigate to="/" replace />}
                  />
                  <Route path="/dashboard" element={<Homepage />} />
                  <Route path="/case/:caseId" element={<VisualizationPage />} />
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
                  {/* Sign in is a popup; sign up is a page. Old /login links land on home. */}
                  <Route path="/login" element={<Navigate to="/" replace />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/account" element={<AccountPage />} />
                  <Route path="/terms" element={<LegalPage kind="terms" />} />
                  <Route path="/privacy" element={<LegalPage kind="privacy" />} />
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
              {/* Global sign-in popup, above all routes. Inside the router so it
                  can link out to /signup. */}
              <AuthModal />
            </BrowserRouter>
          </div>
        </AnnotationProvider>
      </FileProvider>
    </AuthProvider>
  );
}

export default App;

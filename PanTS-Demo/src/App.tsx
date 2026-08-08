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

const VisualizationPage = lazy(() => import("./routes/VisualizationPage"));
const CompareViewerPage = lazy(() => import("./routes/CompareViewerPage"));
const UploadPage = lazy(() => import("./routes/UploadPage"));
const SettingsPage = lazy(() => import("./routes/Settings"));
const ProfileSettings = lazy(() => import("./routes/Settings/ProfileSettings"));
const PlanSettings = lazy(() => import("./routes/Settings/PlanSettings"));
const HistorySettings = lazy(() => import("./routes/Settings/HistorySettings"));
const PrivacySettings = lazy(() => import("./routes/Settings/PrivacySettings"));
const SignupRedirect = lazy(() => import("./routes/SignupRedirect"));
const LegalPage = lazy(() => import("./routes/LegalPage"));
const RotatingHeartLoader = lazy(() => import("./components/Loading"));
const SharePatientCard = lazy(() => import("./routes/SharePatientCard"));
const AwardDemoPage = lazy(() => import("./routes/AwardDemoPage"));

const BASENAME = import.meta.env.VITE_BASENAME;
function RouteFallback(){return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#08090b"}}><div className="animate-spin" style={{width:28,height:28,borderRadius:"50%",border:"2px solid rgba(255,255,255,0.15)",borderTopColor:"rgba(255,255,255,0.6)"}}/></div>}

function App(){return <AuthProvider><FileProvider><AnnotationProvider><div className="App"><BrowserRouter basename={BASENAME}><ScrollToTopButton/><Suspense fallback={<RouteFallback/>}><Routes>
<Route path="/" element={<LandingPage/>}/><Route path="/home.html" element={<Navigate to="/" replace/>}/><Route path="/dashboard" element={<Homepage/>}/>
<Route path="/case/:caseId" element={<VisualizationPage/>}/><Route path="/session/:sessionId" element={<VisualizationPage/>}/><Route path="/dicom" element={<VisualizationPage/>}/><Route path="/local-nifti" element={<VisualizationPage/>}/><Route path="/reconstruction/:reconstructionId" element={<VisualizationPage/>}/>
<Route path="/share/:shareId" element={<SharePatientCard/>}/><Route path="/demo" element={<AwardDemoPage/>}/>
<Route path="/test" element={<RotatingHeartLoader/>}/><Route path="/upload" element={<UploadPage/>}/><Route path="/login" element={<Navigate to="/" replace/>}/><Route path="/signup" element={<SignupRedirect/>}/>
<Route path="/account" element={<SettingsPage/>}><Route index element={<ProfileSettings/>}/><Route path="plan" element={<PlanSettings/>}/><Route path="history" element={<HistorySettings/>}/><Route path="privacy" element={<PrivacySettings/>}/></Route>
<Route path="/terms" element={<LegalPage kind="terms"/>}/><Route path="/privacy" element={<LegalPage kind="privacy"/>}/><Route path="/api" element={<Navigate to="/upload" replace/>}/><Route path="/team" element={<TeamPage/>}/><Route path="/compare" element={<ComparePage/>}/><Route path="/compare-viewer" element={<CompareViewerPage/>}/>
</Routes></Suspense><AuthModal/></BrowserRouter></div></AnnotationProvider></FileProvider></AuthProvider>}
export default App;

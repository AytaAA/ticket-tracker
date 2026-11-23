import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, RequireAuth } from "./auth";
import AppLayout from "./components/AppLayout";
import BoardPage from "./pages/BoardPage";
import TeamsPage from "./pages/TeamsPage";
import EpicsPage from "./pages/EpicsPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import VerifyPage from "./pages/VerifyPage";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public (§3.8) */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify" element={<VerifyPage />} />

        {/* Everything else needs a session */}
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/board" element={<BoardPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/epics" element={<EpicsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/board" replace />} />
      </Routes>
    </AuthProvider>
  );
}

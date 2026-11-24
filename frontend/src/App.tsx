import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, useParams } from "react-router-dom";
import { AuthProvider, RequireAuth } from "./auth";
import AppLayout from "./components/AppLayout";
import BoardPage from "./pages/BoardPage";
import EpicsPage from "./pages/EpicsPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import TeamsPage from "./pages/TeamsPage";
import TicketPage from "./pages/TicketPage";
import VerifyPage from "./pages/VerifyPage";

// /tickets/new and /tickets/:id get a fresh page each, so no state (e.g. "no ticket loaded yet")
// carries over from the create form to the saved ticket (code review 2026-11-24).
function TicketRoute() {
  const { id } = useParams();
  return <TicketPage key={id ?? "new"} />;
}

// A data router (not <BrowserRouter>) so pages can block navigation while they have unsaved changes (useBlocker).
export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route
      element={
        <AuthProvider>
          <Outlet />
        </AuthProvider>
      }
    >
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
        <Route path="/tickets/new" element={<TicketRoute />} />
        <Route path="/tickets/:id" element={<TicketRoute />} />
      </Route>

      <Route path="*" element={<Navigate to="/board" replace />} />
    </Route>,
  ),
  { future: { v7_relativeSplatPath: true } },
);

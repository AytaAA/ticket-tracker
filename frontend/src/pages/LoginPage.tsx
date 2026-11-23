import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, errorMessage } from "../api";
import { useAuth } from "../auth";
import { ResendStatus, useResend } from "../components/ResendVerification";

// §10.4 Login + §10.3 resend action (wireframe 2, left card)
export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/board";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notVerified, setNotVerified] = useState(false);
  const { status: resendStatus, resend } = useResend();

  if (user) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotVerified(false);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setNotVerified(err instanceof ApiError && err.code === "email_not_verified");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1>Log in</h1>
        <p className="muted">Use your verified account.</p>

        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p className="alert alert-error" role="alert" data-testid="login-error">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>

        <div className={`resend-box${notVerified ? " highlight" : ""}`}>
          <p className="muted">Account not verified?</p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={resendStatus.kind === "sending"}
            onClick={() => resend(email)}
          >
            {resendStatus.kind === "sending" ? "Sending…" : "Resend email"}
          </button>
          <ResendStatus status={resendStatus} />
        </div>

        <p className="auth-switch">
          <Link to="/signup">Create an account →</Link>
        </p>
      </form>
    </div>
  );
}

import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, ApiError, errorMessage } from "../api";
import { useAuth } from "../auth";
import { ResendStatus, useResend } from "../components/ResendVerification";

const MIN_PASSWORD = 8; // §3.3

type FieldErrors = { email?: string; password?: string; confirm?: string; form?: string };
type SignupResult = { id: number; email: string; verification_email_sent: boolean };

// §10.1 Sign-up screen (wireframe 2, middle card)
export default function SignupPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<SignupResult | null>(null);
  const { status: resendStatus, resend } = useResend();

  if (user) return <Navigate to="/board" replace />;

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!email.trim()) errs.email = "Email is required.";
    if (password.length < MIN_PASSWORD) errs.password = `Password must be at least ${MIN_PASSWORD} characters.`;
    else if (!password.trim()) errs.password = "Password cannot consist of spaces only.";
    if (confirm !== password) errs.confirm = "Passwords do not match.";
    return errs;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      setDone(await api<SignupResult>("/auth/signup", { method: "POST", body: { email, password } }));
    } catch (err) {
      if (err instanceof ApiError && (err.field === "email" || err.field === "password")) {
        setErrors({ [err.field]: err.message });
      } else {
        setErrors({ form: errorMessage(err) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="auth-page">
        <div className="card auth-card" data-testid="signup-success">
          <h1>Check your email</h1>
          {done.verification_email_sent ? (
            <p className="alert alert-success" role="status">
              We sent a verification link to <strong>{done.email}</strong>. Open it to activate your account. The link
              expires in 24 hours.
            </p>
          ) : (
            <p className="alert alert-error" role="alert">
              Your account was created, but the verification email could not be sent. Try "Resend email" below.
            </p>
          )}
          <div className="resend-box">
            <p className="muted">Didn't get it?</p>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={resendStatus.kind === "sending"}
              onClick={() => resend(done.email)}
            >
              {resendStatus.kind === "sending" ? "Sending…" : "Resend email"}
            </button>
            <ResendStatus status={resendStatus} />
          </div>
          <p className="auth-switch">
            <Link to="/login">Go to log in →</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={onSubmit} noValidate>
        <h1>Create account</h1>
        <p className="muted">Email verification is required.</p>

        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          aria-invalid={!!errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {errors.email && <p className="field-error">{errors.email}</p>}

        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          placeholder={`Minimum ${MIN_PASSWORD} characters`}
          value={password}
          aria-invalid={!!errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {errors.password && <p className="field-error">{errors.password}</p>}

        <label htmlFor="signup-confirm">Confirm password</label>
        <input
          id="signup-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          aria-invalid={!!errors.confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {errors.confirm && <p className="field-error">{errors.confirm}</p>}

        {errors.form && (
          <p className="alert alert-error" role="alert">
            {errors.form}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? "Signing up…" : "Sign up"}
        </button>

        <p className="auth-switch">
          <Link to="/login">Already registered? Log in →</Link>
        </p>
      </form>
    </div>
  );
}

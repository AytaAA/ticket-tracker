import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, errorMessage } from "../api";
import { ResendStatus, useResend } from "../components/ResendVerification";

type State =
  | { kind: "verifying" }
  | { kind: "success" }
  | { kind: "error"; code: string; message: string };

const TITLES: Record<string, string> = {
  token_expired: "Link expired",
  token_used: "Link already used",
  token_invalid: "Invalid link",
};

// §10.2 Verification result screen + §10.3 resend (wireframe 2, right card).
// The email links here; this page POSTs the token so link-scanners can't burn it (PLAN.md D3).
export default function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>({ kind: "verifying" });
  const [email, setEmail] = useState("");
  const { status: resendStatus, resend } = useResend();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // run once even under React StrictMode (single-use token)
    started.current = true;
    if (!token) {
      setState({ kind: "error", code: "token_invalid", message: "This verification link is missing its token." });
      return;
    }
    api("/auth/verify", { method: "POST", body: { token } })
      .then(() => setState({ kind: "success" }))
      .catch((e) =>
        setState({
          kind: "error",
          code: e instanceof ApiError ? e.code : "error",
          message: errorMessage(e),
        }),
      );
  }, [token]);

  return (
    <div className="auth-page">
      <div className="card auth-card verify-card">
        <h1>Email verification</h1>

        {state.kind === "verifying" && <p className="muted">Verifying your email…</p>}

        {state.kind === "success" && (
          <div data-testid="verify-success">
            <div className="verify-icon ok" aria-hidden>
              ✓
            </div>
            <h2>Email verified</h2>
            <p className="muted">Your account is ready to use.</p>
            <Link to="/login" className="btn btn-primary btn-block">
              Continue to login
            </Link>
          </div>
        )}

        {state.kind === "error" && (
          <div data-testid="verify-error">
            <div className="verify-icon bad" aria-hidden>
              !
            </div>
            <h2>{TITLES[state.code] ?? "Verification failed"}</h2>
            <p className="alert alert-error" role="alert">
              {state.message}
            </p>
            {state.code === "token_used" ? (
              <p className="muted">If you already verified your email, you can log in.</p>
            ) : (
              <form
                className="resend-box"
                onSubmit={(e) => {
                  e.preventDefault();
                  resend(email);
                }}
              >
                <p className="muted">Enter your email to get a new verification link.</p>
                <label htmlFor="verify-email">Email</label>
                <input
                  id="verify-email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button type="submit" className="btn btn-secondary" disabled={resendStatus.kind === "sending"}>
                  {resendStatus.kind === "sending" ? "Sending…" : "Resend email"}
                </button>
                <ResendStatus status={resendStatus} />
              </form>
            )}
            <p className="auth-switch">
              <Link to="/login">Go to log in →</Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

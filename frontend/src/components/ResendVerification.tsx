import { useState } from "react";
import { api, errorMessage } from "../api";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; message: string } | { kind: "error"; message: string };

/** §3.7 / §10.3: request a new verification email. The server always answers the same way (PLAN.md D8). */
export function useResend() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function resend(email: string) {
    if (!email.trim()) {
      setStatus({ kind: "error", message: "Enter your email address first." });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const r = await api<{ message: string }>("/auth/resend-verification", { method: "POST", body: { email } });
      setStatus({ kind: "sent", message: r.message });
    } catch (e) {
      setStatus({ kind: "error", message: errorMessage(e) });
    }
  }

  return { status, resend };
}

export function ResendStatus({ status }: { status: Status }) {
  if (status.kind === "sent")
    return (
      <p className="alert alert-success" role="status" data-testid="resend-status">
        {status.message}
      </p>
    );
  if (status.kind === "error")
    return (
      <p className="alert alert-error" role="alert" data-testid="resend-status">
        {status.message}
      </p>
    );
  return null;
}

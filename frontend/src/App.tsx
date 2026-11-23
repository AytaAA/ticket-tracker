import { useEffect, useState } from "react";

type Health =
  | { kind: "loading" }
  | { kind: "ok"; db: string }
  | { kind: "error"; message: string };

export default function App() {
  const [health, setHealth] = useState<Health>({ kind: "loading" });

  useEffect(() => {
    fetch("/api/health")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (r.ok) setHealth({ kind: "ok", db: body.db });
        else setHealth({ kind: "error", message: `HTTP ${r.status} (db: ${body.db ?? "?"})` });
      })
      .catch((e: Error) => setHealth({ kind: "error", message: e.message }));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1>Ticket Tracker</h1>
      {health.kind === "loading" && <p data-testid="api-status">API: checking…</p>}
      {health.kind === "ok" && (
        <p data-testid="api-status">
          API: ok · DB: {health.db}
        </p>
      )}
      {health.kind === "error" && (
        <p data-testid="api-status" style={{ color: "crimson" }}>
          API: error ({health.message})
        </p>
      )}
    </main>
  );
}

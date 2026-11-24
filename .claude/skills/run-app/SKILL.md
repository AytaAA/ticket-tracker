---
name: run-app
description: Rebuild and start the ticket-tracker Docker Compose stack (db, backend, frontend, mailpit) through WSL, wait for health checks, and print the app, API docs and Mailpit URLs. Use this whenever the user says run/start/restart/rebuild the app or stack, "bring it up", "is it running", wants a fresh/empty database, or before any QA or Playwright check that needs the app live — even if they don't type /run-app.
---

# Run the app

Docker only exists inside WSL on this machine, so everything goes through `wsl -d Ubuntu`. The bundled script does the
whole sequence (checks → `docker compose up --build -d --wait` → health check → URLs) so each run behaves the same way.

## Steps

1. From the repo root, run (Windows side, via the Bash or PowerShell tool):
   ```
   wsl -d Ubuntu -- bash .claude/skills/run-app/scripts/run-app.sh
   ```
   Add `--clean` at the end when the user wants a fresh, empty database (it runs `docker compose down -v` first).
   Use `--clean` only when asked, or when verifying §9.9 "fresh DB has no data", because it deletes all test data.
   Allow up to ~5 minutes: the first build downloads images.

2. Report to the user **with proof**: paste the `docker compose ps` table, the health-check response, and the three URLs:
   - App: http://localhost:8080
   - API docs: http://localhost:8080/api/docs
   - Mailpit (verification emails): http://localhost:8025

## When it fails

The script exits non-zero with a `FAIL:` line that tells you which stage broke:

| Exit | Meaning | What to do |
|---|---|---|
| 2 | docker not found in WSL | Tell the user; Docker Desktop/engine in WSL must be running |
| 3 | no `docker-compose.yml` | The compose file is missing — say so, don't invent one |
| 5 | containers unhealthy | Read the printed logs, quote the exact error lines, diagnose |
| 6 | `/api/health` not answering | Look at backend logs (migrations failing is the usual cause) |

Quote the exact error lines from the output rather than paraphrasing — the user is a QA and works from exact messages.
Don't claim the app is running unless the script printed `OK - stack is up.`

If the script itself errors with `\r` / `bad interpreter`, its line endings were converted to CRLF; `.gitattributes`
should keep it LF — fix the file's line endings rather than working around it.

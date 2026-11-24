# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status
Kanban ticket tracker. Built by a manual QA acting as product owner; Claude writes the code.
**Complete:** all requirements (§3–§11) are implemented and tested, plus the product-owner changes recorded in
`docs/PLAN.md` §7 (C1–C8). QA and review reports are in `docs/qa/`.
- `docs/project_requirements.md` — **source of truth** (requirements, cite as §N.N).
- `docs/PLAN.md` — approved schema, API (with status codes), screens, slice order; **§7 = changes decided after
  approval**. Follow it; propose changes, don't drift silently, and record every new product-owner decision in §7.
- `docs/wireframes/` — reference UI (not pixel-binding, §15).
- `README.md` — how to run and test; section "Beyond the requirements" lists everything added on top of the
  requirements. Keep it in sync when adding such a feature.

Never add features outside project_requirements.md: §12 is out of scope, §14 stretch features only on explicit request
(edit/delete own comments was requested and is done). `docs/PLAN.md` §5 lists rejected ideas.

## Stack and layout
| Path | Tier |
|---|---|
| `backend/` | Python, FastAPI, SQLAlchemy, Alembic (`alembic/versions/0001…0008`), argon2-cffi; pytest tests in `backend/tests/` |
| `frontend/` | React + TypeScript + Vite, dnd-kit for drag-and-drop, react-router **data router** (needed for `useBlocker`); built SPA served by nginx (`frontend/nginx.conf`), which proxies `/api` → backend and sends security headers |
| `e2e/` | Playwright `.spec.ts` end-to-end tests (`tests/helpers.ts`: `loginAsNewUser`, `dragTo`, Mailpit helpers) |
| `scripts/bulk_tickets.py` | Creates 100+ test tickets through the API (stdlib only) |
| `docker-compose.yml` | 4 services: `db` (PostgreSQL 16), `backend`, `frontend` (nginx), `mailpit` |

Auth: random session id in an httpOnly cookie, stored hashed in a `sessions` table. Nothing secret in URLs except the
single-use verification token (§9.6).
Config: **`.env` is optional** — every setting has a default in `docker-compose.yml` / `backend/app/config.py`;
`.env.example` is the source of truth for variable names. Ports `APP_PORT` (8080) and `MAILPIT_PORT` (8025) are
published on `127.0.0.1` only; `APP_BASE_URL` defaults to `http://localhost:<APP_PORT>`. Dev mail goes to Mailpit;
`relay1.dataart.com` must stay configurable via `SMTP_*`.

## How to run
Docker exists **only inside WSL**. Always run compose from the repository root through:
```
wsl -d Ubuntu -- bash -lc "<command>"
```
- Start / rebuild: `docker compose up --build -d --wait` (or `/run-app`)
- Status / logs: `docker compose ps`, `docker compose logs backend`
- Wipe DB and restart from clean: `docker compose down -v && docker compose up --build -d --wait` (wipes the user's test accounts — ask first)
- URLs: app http://localhost:8080 · API docs http://localhost:8080/api/docs · Mailpit http://localhost:8025
- Backend tests: `docker compose exec backend pytest` (single: `pytest tests/test_x.py::test_name`). They use a separate `<db>_test` database.
- E2E tests (Windows, from `e2e/`): `npx playwright test` (single: `npx playwright test path/to.spec.ts -g "name"`).
  ~1.2 min, mostly the resend test waiting out the 60 s cooldown. Other ports: `BASE_URL` / `MAILPIT_URL`.
  Tests must create their own data with unique names and delete the teams/epics/tickets they create.
- Playwright MCP (`.mcp.json`) is available for driving a real browser during QA.

## Project skills and agents
- `/run-app` (`.claude/skills/run-app/`): rebuild + start the stack via WSL, wait for health, print URLs. `--clean` wipes the DB.
- `/qa-slice <feature>` (`.claude/skills/qa-slice/`): test cases from project_requirements.md → Playwright run → report in `docs/qa/<feature>/`.
- `qa-tester` subagent (`.claude/agents/qa-tester.md`): independent, read-only tester with Playwright MCP tools; returns a pass/fail report against project_requirements.md. Use it to check work built by the main session.

## Hard rules
- **No seed data** on startup or in migrations; a fresh DB has schema + migration metadata only (§9.9). Bulk test data (e.g. 100+ tickets) is created through the API from test scripts.
- Schema changes only via Alembic migrations, applied automatically on backend start (§9.8).
- No secrets or real passwords in code, commits or prompts; only placeholders in `.env.example`.
- Enum values exactly as §6.1: type `bug|feature|fix`; state `new|ready_for_implementation|in_progress|ready_for_acceptance|done`. UI shows human labels with spaces. Validate on the backend (§6.9).
- Timestamps: server-set, UTC, ISO-8601 with `Z`.
- Deleting a team with tickets/epics, or an epic referenced by tickets → **409** with a clear message; no cascade (§4.5, §5.8). Deleting a ticket cascades to its comments (§6.7).
- Ticket `modified_at` moves only on a real field/state change; saving unchanged values, or adding/editing/deleting a comment, must not move it (§6.5, §7.5).
- Ticket epic must belong to the ticket's team (enforced by a composite FK and API checks, §5.7). Epic team is immutable (§5.2).
- Emails trimmed and compared case-insensitively; team names trimmed and unique case-insensitively. Passwords: ≥ 8 characters and not whitespace only.
- Status codes: 401 unauthenticated · 403 not the comment's author / cross-origin request · 404 missing · 409 conflict · 415 body not JSON · 422 validation (see PLAN.md §2). Error body `{code, message, field?}`.
- **CSRF guard** (`backend/app/main.py`): POST/PUT/PATCH/DELETE on `/api` need a JSON body and, when a browser sends `Origin`, the same host:port. New clients must send `Content-Type: application/json`.
- Comments: only the **author** may edit or delete (403 otherwise); edits set `edited_at`.
- Verification email: at most one per address every `RESEND_COOLDOWN_SECONDS` (60), sign-up included; resend always answers 202 with the same message (D8).
- UI: **every delete is confirmed** (`components/ConfirmDialog.tsx`); **every edit form uses `useUnsavedChanges`** (`src/unsaved.tsx`) — "Leave without saving changes?" **Yes** leaves, **No** stays with the edits; call `allowNavigation()` before navigating on purpose after a save/delete.
- UI lists: only the latest request may update a list (request counter / ignore stale responses); a change made while a list is still loading triggers a reload instead of a merge.
- LF line endings for anything that runs in containers (enforced by `.gitattributes`); this matters because the host is Windows.

## Definition of Done for each change
1. `docker compose up --build` succeeds and containers are healthy.
2. pytest tests for the business rules pass (whole suite).
3. Playwright check (MCP session or `e2e/` spec) passes, with evidence (output/screenshots) shown; the whole e2e suite stays green.
4. Product-owner decisions recorded in `docs/PLAN.md` §7; user-visible extras listed in README "Beyond the requirements".
5. Committed with a descriptive message.
Show proof (command output, test results), never "it should work".

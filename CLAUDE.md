# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status
Kanban ticket tracker. Built by a manual QA acting as product owner; Claude writes the code.
- `docs/project_requirements.md` — **source of truth** (requirements, cite as §N.N).
- `docs/PLAN.md` — approved schema, API (with status codes), screens, slice order. Follow it; propose changes, don't drift silently.
- `docs/ROADMAP.md` — phase-by-phase process. `docs/wireframes/` — reference UI (not pixel-binding, §15).
- No application code exists until Phase 4 (walking skeleton). Sections below marked *(planned)* describe the target layout.

Never add features outside project_requirements.md: §12 is out of scope, §14 stretch features only on explicit request. `docs/PLAN.md` §5 lists rejected ideas.

## Stack and layout *(planned)*
| Path | Tier |
|---|---|
| `backend/` | Python, FastAPI, SQLAlchemy, Alembic, argon2-cffi; pytest tests in `backend/tests/` |
| `frontend/` | React + TypeScript + Vite, dnd-kit for drag-and-drop; built SPA served by nginx, which proxies `/api` → backend |
| `e2e/` | Playwright `.spec.ts` end-to-end tests |
| `docker-compose.yml` | 4 services: `db` (PostgreSQL 16), `backend`, `frontend` (nginx), `mailpit` |

Auth: random session id in an httpOnly cookie, stored hashed in a `sessions` table. Nothing secret in URLs except the single-use verification token (§9.6).
Config comes from `.env` (copy of `.env.example`, which is the source of truth for variable names). Dev mail goes to Mailpit; `relay1.dataart.com` must stay configurable via `SMTP_*`.

## How to run
Docker exists **only inside WSL**. Always run compose from the repository root through:
```
wsl -d Ubuntu -- bash -lc "<command>"
```
- Start / rebuild: `docker compose up --build -d`
- Status / logs: `docker compose ps`, `docker compose logs backend`
- Wipe DB and restart from clean: `docker compose down -v && docker compose up --build -d`
- URLs: app http://localhost:8080 · API docs http://localhost:8080/api/docs *(planned)* · Mailpit http://localhost:8025
- Tests *(planned)*: `docker compose exec backend pytest` (single test: `pytest tests/test_x.py::test_name`); Playwright in `e2e/`: `npx playwright test` (single: `npx playwright test path/to.spec.ts -g "name"`)
- Playwright MCP (`.mcp.json`) is available for driving a real browser during QA.

## Hard rules
- **No seed data** on startup or in migrations; a fresh DB has schema + migration metadata only (§9.9). Bulk test data (e.g. 100+ tickets) is created through the API from test scripts.
- Schema changes only via Alembic migrations, applied automatically on backend start (§9.8).
- No secrets or real passwords in code, commits or prompts; only placeholders in `.env.example`.
- Enum values exactly as §6.1: type `bug|feature|fix`; state `new|ready_for_implementation|in_progress|ready_for_acceptance|done`. UI shows human labels with spaces. Validate on the backend (§6.9).
- Timestamps: server-set, UTC, ISO-8601 with `Z`.
- Deleting a team with tickets/epics, or an epic referenced by tickets → **409** with a clear message; no cascade (§4.5, §5.8). Deleting a ticket cascades to its comments (§6.7).
- Ticket `modified_at` moves only on a real field/state change; saving unchanged values or adding a comment must not move it (§6.5, §7.5).
- Ticket epic must belong to the ticket's team (enforced by a composite FK and API checks, §5.7). Epic team is immutable (§5.2).
- Emails trimmed and compared case-insensitively; team names trimmed and unique case-insensitively.
- Status codes: 401 unauthenticated, 404 missing, 409 conflict, 422 validation (see PLAN.md §2).
- LF line endings for anything that runs in containers (enforced by `.gitattributes`); this matters because the host is Windows.

## Definition of Done for each slice
1. `docker compose up --build` succeeds and containers are healthy.
2. pytest tests for the slice's business rules pass.
3. Playwright check (MCP session or `e2e/` spec) passes, with evidence (output/screenshots) shown.
4. Committed with a descriptive message.
Show proof (command output, test results), never "it should work".

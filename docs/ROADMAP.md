# Plan: Build the Ticket Tracker with AI agents (for a manual QA, 1–2 days)

## Context
You are a manual QA with no coding experience. You have 1–2 days to deliver a Kanban ticket tracker
(requirements: `docs/project_requirements.md`).
Claude Code writes the code. Your roles are **product owner** (you decide what gets built and accept it) and **QA**
(you test every slice yourself and with Playwright). The plan follows the workflow from the guide
artifact: write the task down, then CLAUDE.md, then a plan in plan mode, then a walking skeleton, then vertical slices with evidence, then a self-audit.

**What your machine already has** (checked on 2026-11-23):
- Windows: Git, Node.js 26 (for the Playwright MCP), Python 3.12, uv, and VS Code with Claude Code
- WSL Ubuntu: Docker 29 and Compose v5.8. The `docker` command is **only** available inside WSL, so Claude runs it as
  `wsl -d Ubuntu -- bash -lc "docker compose up --build -d"`
- The project folder is a git repo with no commits yet. No remote is needed for now.
- Access to the SMTP relay is unknown, so a local fake mail server (Mailpit) is used for development. `relay1.dataart.com` stays configurable through `.env`.

## Proposed tech stack (for you to approve or adjust)
| Tier | Choice | Why |
|---|---|---|
| DB | PostgreSQL 16 container | Required "server-based RDBMS" |
| Backend | Python + FastAPI, SQLAlchemy, Alembic migrations, argon2-cffi | Your preference. Generates API docs at `/docs`, which you can click through by hand. |
| Frontend | React + TypeScript + Vite, dnd-kit for drag-and-drop | Your preference. dnd-kit is a well-supported library for drag-and-drop. |
| Serving | nginx container serves the built SPA and forwards `/api` to the backend | Keeps the 3 tiers clearly separated |
| Mail (dev) | Mailpit container (web inbox at http://localhost:8025) | Lets you see verification emails without the real relay |
| Tests | pytest (backend business flows) + Playwright (end-to-end UI flows) | Covers the requirement for both kinds of automated test |

Auth uses an httpOnly session cookie, so no tokens appear in URLs.

---

## Phase 0 — Learn the basics (≈1.5 h, do this first)
Goal: be comfortable steering Claude Code before you build anything.
1. Read the **Working with Claude** section of the guide artifact again. Focus on "Do / Avoid" and the prompt templates.
2. Practice in this VS Code panel:
   - **Shift+Tab** cycles normal mode → auto-accept edits → plan mode
   - **Esc** interrupts Claude; **Esc Esc** rewinds to an earlier point
   - `@file` points Claude at a file
   - `/clear` starts fresh between features; `/compact` shortens a long session
   - `/init` creates CLAUDE.md; `/mcp` shows MCP servers; `/agents` manages subagents
3. Concepts to understand in 1–2 sentences each:
   - **CLAUDE.md**: the project rulebook that Claude reads at the start of every session
   - **Skill**: a saved, reusable instruction set you run as a `/command`
   - **Subagent**: a helper Claude with its own job and tools, for example a QA tester
   - **MCP**: a plug-in that gives Claude new tools. The Playwright MCP lets Claude drive a real browser.
   - **Git commit**: a save point you can return to
4. Learn just enough Docker to read it: `docker compose up --build`, `docker compose ps`, `docker compose logs backend`, `docker compose down -v` (`-v` wipes the database).

## Phase 1 — Environment setup (≈45 min)
Ask Claude to do each step and to show you the output as proof.
1. **Task as Markdown**: Claude converts the requirements document to `docs/project_requirements.md`, keeping the section numbers so you can cite "§6".
   Save the wireframe images to `docs/wireframes/`.
2. **Check that Docker works from Claude**: Claude runs `wsl -d Ubuntu -- docker run --rm hello-world`.
3. **Install the Playwright MCP** (project scope, so it is saved in `.mcp.json` inside the repo):
   `claude mcp add playwright --scope project -- npx @playwright/mcp@latest`
   Then run `/mcp` and confirm `playwright` shows as connected. Smoke test: "Use Playwright to open https://example.com and tell me the page title."
4. **Optional security check** (DataArt): run the `da-security` skill in scan mode on `.mcp.json`.
5. `.gitignore`: `.env`, `node_modules`, `__pycache__`, `.venv`, `playwright-report`. Add a `.env.example` with placeholders only.
6. First commit: "chore: task + tooling".

## Phase 2 — CLAUDE.md, skills and agents (≈1 h)
1. Run **`/init`** (the built-in skill). It drafts CLAUDE.md. Then ask Claude to add these sections:
   - **Source of truth**: `docs/project_requirements.md`. Never add out-of-scope features (§12).
   - **Stack and layout**: `backend/`, `frontend/`, `e2e/`, `docker-compose.yml`
   - **How to run**: the `wsl -d Ubuntu -- bash -lc "…"` command form
   - **Hard rules**:
     - no seed data on startup
     - no secrets in code
     - enums exactly as in §6
     - UTC ISO-8601 timestamps
     - deleting a team or epic that is still referenced returns 409
     - `modified_at` changes only on a real change
     - LF line endings for scripts that run inside containers
   - **Definition of Done for each slice**: stack builds, tests pass, Playwright check passes, commit made
2. **Create 2 project skills** with the `skill-creator` skill. They are saved in `.claude/skills/`.
   - `/run-app`: rebuild and start the stack, wait for health checks, print the URLs (app, API docs, Mailpit)
   - `/qa-slice <feature>`: read the matching project_requirements.md section, write test cases, run them with Playwright MCP, and report pass/fail with screenshots
3. **Create a `qa-tester` subagent** with `/agents`. It has Playwright MCP tools and read-only file access, and checks features against project_requirements.md.
   It tests independently from the agent that wrote the code.
4. Commit: "chore: CLAUDE.md, skills, qa agent".

## Phase 3 — Plan in plan mode (≈45 min)
Press **Shift+Tab** until plan mode is on, then use a prompt like: *"Read @docs/project_requirements.md and @CLAUDE.md. Propose the DB schema, the API
endpoint list with status codes, the screens, and a build order of vertical slices. Do not write code yet."*
Check the result against requirements §3–§9 like you would review a test basis. Reject anything over-engineered. Approve it, then save it as `docs/PLAN.md`.

## Phase 4 — Walking skeleton (≈2 h)
Build the smallest version that runs end to end: 4 containers (db, backend, frontend, mailpit). The page calls `/api/health`, the backend reads from Postgres, and Alembic migrations run on start.
**Acceptance (your check)**: `/run-app` works, the page loads in Chrome, `docker compose down -v` followed by `up --build` still works, and the DB has no rows.
Commit.

## Phase 5 — Vertical slices (≈8–10 h, the core of the work)
Run the same loop for each slice: **`/clear` → prompt that cites a project_requirements.md section → Claude builds it and adds pytest tests → `/run-app` →
`/qa-slice` (or the qa-tester agent) → you test by hand → fix → commit.**
| # | Slice | Key checks (your QA eye) |
|---|---|---|
| 1 | Auth + email verification (§3) | Email is trimmed and case-insensitive. Password needs 8+ characters. Mail arrives in Mailpit. Token is single-use, expires after 24 h, and resending invalidates the old one. Unverified user is blocked. Logout works. APIs return 401. |
| 2 | Teams (§4) | Name is trimmed and unique ignoring case. Rename works. Delete is blocked with a 409 and a clear message. |
| 3 | Epics (§5) | Separate screen. Team is fixed after creation. Delete is blocked when referenced. |
| 4 | Tickets (§6) | All fields are present and enums are validated. Epic must belong to the same team. Changing the team clears the epic. Saving unchanged data does not move `modified_at`. Delete asks for confirmation and removes comments. |
| 5 | Board + drag-and-drop (§8) | 5 columns. Ordered by modified date, newest first. A drop is saved. A failed drop rolls the card back and shows an error. The board survives a refresh. |
| 6 | Comments (§7) | Oldest first. Author and time are shown. Adding a comment does not change `modified_at`. |
| 7 | Filters + search (§8) | Type AND epic AND title search (case-insensitive) work together. |
| 8 | 100+ tickets | Claude creates them through the API in a test script, not as seed data. The board stays usable. |
If you are short on time, slices 1–6 are the Definition of Done. Slice 7 is required but small. Skip all stretch features (§14).

## Phase 6 — Automated tests and QA (runs alongside Phase 5, plus ≈2 h at the end)
- **pytest** (backend business flows): sign-up and verification, the 409 conflicts, the epic and team rule, `modified_at` rules.
- **Playwright end-to-end suite** in `e2e/`. Ask Claude to turn the MCP sessions you trust into saved `.spec.ts` tests,
  for example sign up → verify through the Mailpit API → log in → create team, epic and ticket → drag → refresh → assert.
- Your manual exploratory pass: use your QA strength on edge cases (spaces, case, double-clicks, expired tokens, network errors).
- Run `/code-review` and `/security-review` on the finished code.

## Phase 7 — Self-audit and hand-off (≈1.5 h)
1. **README** (§11): prerequisites, `.env` setup (Mailpit default, relay1.dataart.com example), start command, how to run tests.
2. **Definition of Done check (§13)**: Claude checks each item and shows evidence. You confirm.
3. **Fresh-clone test**: clone the repo into a new folder in WSL, run `cp .env.example .env`, run `docker compose up --build`, then run the full QA pass.
4. If you can reach the network: set the SMTP variables in `.env` to `relay1.dataart.com` and send one real verification email.

## Rules to follow the whole time
- Make small, specific requests and cite the project_requirements.md section. Never ask Claude to "build the whole app".
- Ask for proof: command output, test results, screenshots. Do not accept "it should work".
- Paste errors exactly as they appear, for example from `docker compose logs backend`.
- If Claude goes around in circles: press Esc, run `/clear`, and describe the problem again in a few lines.
- Commit after every working slice. Never put real passwords in prompts or commits.

## Verification (how we know the whole thing works)
- `docker compose down -v && docker compose up --build` from the repo root, run inside WSL, gives a working app and an empty DB.
- pytest is green, the Playwright suite is green, and the qa-tester agent report passes against all 10 Definition of Done items.
- Your manual walkthrough of the 5 wireframe flows in Chrome passes.

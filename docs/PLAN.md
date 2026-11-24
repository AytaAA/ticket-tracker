# Build Plan — Ticket Tracker

> Status: **APPROVED by product owner, 2026-11-23** (Phase 3 of `docs/ROADMAP.md`). Decisions D1–D9 accepted as proposed.
> Source of truth: `docs/project_requirements.md`. Every item below cites the § it implements. Anything not traceable to project_requirements.md is
> out of scope (§12, §14).

Stack (from ROADMAP): PostgreSQL 16 · FastAPI + SQLAlchemy + Alembic + argon2-cffi · React + TypeScript + Vite + dnd-kit
· nginx (serves SPA, proxies `/api`) · Mailpit (dev SMTP) · pytest + Playwright.

---

## 0. Decisions to approve (product owner)

| # | Decision | Proposal | Why / alternative |
|---|---|---|---|
| D1 | ID type | Auto-increment integers | Readable in UI and bug reports ("Ticket #42"). §9.5 allows either. |
| D2 | Sessions | Random session id in an httpOnly cookie, stored in a `sessions` table | Logout truly ends the session. Nothing in URLs (§9.6). JWT rejected: harder to revoke. |
| D3 | Verification link | Email links to the SPA page `/verify?token=…`; that page calls `POST /api/auth/verify` | Mail scanners that pre-open links can't burn the single-use token (§3.6). |
| D4 | Validation errors | HTTP **422** (FastAPI default) with a field + message | 409 only for conflicts (duplicate name, delete blocked). |
| D5 | Filters & search | Client-side on the loaded team board | §8.9 allows it; 100–500 tickets is small. No pagination. |
| D6 | Enum storage | `VARCHAR` + `CHECK` constraint (not Postgres enum types) | Exactly the §6.1 values, simpler migrations. |
| D7 | Ticket create/edit | One full page used for new and existing tickets | Matches wireframe 3. |
| D8 | Resend verification | Always answers `202` with a generic message | Doesn't reveal which emails are registered. |
| D9 | Selected team | Kept in the URL (`/board?team=3`) | Survives refresh, no localStorage as system of record (§9.2). |

---

## 1. Database schema

All timestamps are `timestamptz`, set by the server in UTC (§6.1, §9.5). No seed data in any migration (§9.9).

### users
| Column | Type | Rules |
|---|---|---|
| id | bigint PK | |
| email | text, not null | Stored trimmed + lowercased; **unique** (§3.1) |
| password_hash | text, not null | Argon2id (§3.3) |
| is_verified | boolean, default false | §3.5 |
| created_at | timestamptz | |

### email_verification_tokens
| Column | Type | Rules |
|---|---|---|
| id | bigint PK | |
| user_id | FK → users, on delete cascade | |
| token_hash | text, unique | Only a SHA-256 of the token is stored; the raw token is only in the email |
| expires_at | timestamptz | created + 24 h (§3.6) |
| used_at | timestamptz, null | Set on use → single-use (§3.6) |

Issuing a new token deletes the user's earlier unused tokens (§3.7).

### sessions
| Column | Type | Rules |
|---|---|---|
| id_hash | text PK | SHA-256 of the cookie value |
| user_id | FK → users, on delete cascade | |
| created_at, expires_at | timestamptz | Lifetime 7 days |

### teams
| Column | Type | Rules |
|---|---|---|
| id | bigint PK | |
| name | text, not null | Trimmed, non-empty; **unique index on `lower(name)`** (§4.4) |
| created_at, modified_at | timestamptz | §4.3 |

### epics
| Column | Type | Rules |
|---|---|---|
| id | bigint PK | |
| team_id | FK → teams, **on delete restrict** | Set on create, never updated (§5.2) |
| title | text, not null | Trimmed, non-empty (§5.5) |
| description | text, null | §5.4 |
| created_at, modified_at | timestamptz | |

Extra unique constraint `(id, team_id)` so tickets can point at "this epic **in this team**".

### tickets
| Column | Type | Rules |
|---|---|---|
| id | bigint PK | |
| team_id | FK → teams, **on delete restrict** | §4.5 |
| epic_id | bigint, null | **Composite FK `(epic_id, team_id)` → `epics(id, team_id)`, on delete restrict** — the DB itself rejects an epic from another team (§5.7) and blocks deleting a referenced epic (§5.8) |
| type | varchar, CHECK in (`bug`,`feature`,`fix`) | §6.1 |
| state | varchar, CHECK in (`new`,`ready_for_implementation`,`in_progress`,`ready_for_acceptance`,`done`) | §6.1 |
| title | text, not null | Trimmed, non-empty |
| body | text, not null | Non-empty |
| created_by | FK → users | From the session (§6.1) |
| created_at, modified_at | timestamptz | `modified_at` only moves on a real change (§6.5) |

Index `(team_id, modified_at desc)` for the board (§8.7, §8.10).

### comments
| Column | Type | Rules |
|---|---|---|
| id | bigint PK | |
| ticket_id | FK → tickets, **on delete cascade** | Ticket delete removes comments (§6.7) |
| author_id | FK → users | |
| body | text, not null | Non-empty (§7.3) |
| created_at | timestamptz | Immutable, no update endpoint (§7.6) |

---

## 2. API

Base path `/api`. JSON in and out. Error body: `{"code": "team_not_empty", "message": "Team has 3 tickets and 1 epic. Delete or move them first."}`
(422 adds `"field"`). Timestamps as `2026-11-23T10:15:00Z`.

**Common codes:** `401` no/expired session (every non-public endpoint, §3.8) · `404` record not found · `409` conflict · `422` validation failed (§9.4).

### Public (§3.8)
| Method + path | Body | Success | Errors |
|---|---|---|---|
| GET `/health` | – | 200 `{status, db}` | 503 DB down |
| POST `/auth/signup` | email, password | 201 (verification email sent) | 422 bad email / password < 8 chars · 409 email already registered |
| POST `/auth/verify` | token | 200 | 400 `token_invalid` / `token_expired` / `token_used` |
| POST `/auth/resend-verification` | email | 202 (always, D8) | 422 malformed email |
| POST `/auth/login` | email, password | 200 + session cookie, returns user | 401 wrong credentials · 403 `email_not_verified` |

### Authenticated
| Method + path | Body | Success | Errors |
|---|---|---|---|
| POST `/auth/logout` | – | 204, session deleted | |
| GET `/auth/me` | – | 200 `{id, email}` | 401 |
| GET `/teams` | – | 200 list with `ticket_count`, `epic_count` (wireframe 4) | |
| POST `/teams` | name | 201 | 422 empty · 409 duplicate name |
| PATCH `/teams/{id}` | name | 200 | 404 · 422 · 409 duplicate |
| DELETE `/teams/{id}` | – | 204 | 404 · **409 has tickets or epics** (§4.5) |
| GET `/epics?team_id=` | – | 200 list with `ticket_count` | 422 team missing |
| POST `/epics` | team_id, title, description? | 201 | 422 empty title / unknown team |
| PATCH `/epics/{id}` | title?, description? | 200 | 404 · 422 (also if `team_id` is sent, §5.2) |
| DELETE `/epics/{id}` | – | 204 | 404 · **409 referenced by tickets** (§5.8) |
| GET `/tickets?team_id=` | – | 200 all tickets of the team, newest `modified_at` first, with epic title | 422 |
| POST `/tickets` | team_id, type, state, title, body, epic_id? | 201 | 422 bad enum / empty / epic from another team (§6.9, §5.7) |
| GET `/tickets/{id}` | – | 200 all fields incl. `created_by` email (§6.3) | 404 |
| PATCH `/tickets/{id}` | any of: team_id, type, state, epic_id, title, body | 200 (`modified_at` changes only if a value differs, §6.5) | 404 · 422 (epic/team mismatch, §6.6) |
| DELETE `/tickets/{id}` | – | 204 (comments deleted too) | 404 |
| GET `/tickets/{id}/comments` | – | 200 oldest first, with author email | 404 |
| POST `/tickets/{id}/comments` | body | 201 (ticket `modified_at` unchanged, §7.5) | 404 · 422 empty |
| PATCH `/tickets/{id}/comments/{cid}` | body | 200, sets `edited_at` (§14 stretch, see §7) | 403 not the author · 404 · 422 empty |
| DELETE `/tickets/{id}/comments/{cid}` | – | 204 (§14 stretch, see §7) | 403 not the author · 404 |

Drag-and-drop = `PATCH /tickets/{id}` with `{"state": "..."}` (§6.8, §8.4).

---

## 3. Screens (SPA routes)

| Route | Screen | § / wireframe |
|---|---|---|
| `/signup` | Email, password, confirm password | §10.1, WF2 |
| `/login` | Login + "Account not verified? Resend email" | §10.3–10.4, WF2 |
| `/verify?token=` | Success → "Continue to login"; expired/invalid → error + resend | §10.2–10.3, WF2 |
| `/board?team=` | Header (Board/Teams/Epics, user menu → Log out), team selector, + New ticket, filters (search, type, epic, Clear, count), 5 columns with counts, drag-and-drop | §8, §10.5, WF1 |
| `/tickets/new?team=` and `/tickets/:id` | Ticket form + meta (ID, created by, created/modified UTC) + Delete (confirm) + comments panel | §6, §7, §10.6, WF3 |
| `/teams` | Table (name, tickets, epics, modified), create dialog, inline rename, Delete disabled when not empty | §4, §10.7, WF4 |
| `/epics?team=` | Team selector, table (title, description, tickets, modified), edit panel, Delete disabled when referenced | §5, §10.8, WF5 |

Every list/form shows loading, empty, success and error states (§11.3). Any 401 sends the user to `/login`.

---

## 4. Build order (vertical slices)

Each slice = migration + API + UI + pytest + Playwright check + commit (Definition of Done in CLAUDE.md).

| Step | Slice | Contents | Key tests |
|---|---|---|---|
| 0 | Walking skeleton (Phase 4) | 4 containers, Alembic on start, `/api/health`, page shows "API: ok" | `down -v` → `up --build` works; DB has 0 rows |
| 1 | Auth + verification | users, tokens, sessions; signup/verify/resend/login/logout/me; screens WF2; route guard | trim + case email; 8 chars; Mailpit mail; single-use; 24 h expiry; resend kills old token; unverified blocked; 401s |
| 2 | Teams | teams table + CRUD + WF4 | unique ignoring case; rename; 409 on delete (tested again after slices 3–4) |
| 3 | Epics | epics + CRUD + WF5 | team fixed; 409 when referenced |
| 4 | Tickets | tickets + CRUD + WF3 form (no comments yet) | enums; epic same-team; team change clears epic; unchanged save keeps `modified_at`; delete confirm |
| 5 | Board + drag-and-drop | WF1 columns, cards, dnd-kit, rollback on failure | 5 columns; order; persists after refresh; failed drop rolls back + error |
| 6 | Comments | comments + panel in WF3 | oldest first; author + time; ticket `modified_at` unchanged; deleted with ticket |
| 7 | Filters + search | client-side filter bar | type AND epic AND title (case-insensitive); Clear; count |
| 8 | 100+ tickets | test script creates 150 tickets **via the API** (not seed data) | board stays responsive |

Slices 1–6 are the minimum Definition of Done; 7 is required but small.

---

## 5. Deliberately NOT included (reject if proposed later)

Pagination, server-side search, WebSockets/live updates, roles/membership, soft delete, optimistic locking (§9.7),
custom card ordering (§8.7), password reset, activity history, virtualization (§14),
JWT/refresh tokens, Redis, a separate admin panel.

---

## 6. Review checklist (for you, as test-basis review)

- [x] §3: every auth rule has a column, an endpoint status code and a test in slice 1
- [x] §4.4/§4.5: unique-ignore-case index; 409 on delete; Delete disabled in UI
- [x] §5.2/§5.7/§5.8: epic team never updatable; composite FK; 409 on delete
- [x] §6.1: all 10 fields present with the exact enum values
- [x] §6.5/§7.5: `modified_at` rules have explicit tests
- [x] §6.7: comments cascade on ticket delete
- [x] §8.2–§8.9: board columns, order, rollback, filters covered by slices 5 and 7
- [x] §9.4: 401/404/409/422 used consistently; §9.6 no tokens in URLs except the verify link
- [x] §9.8/§9.9: Alembic on start, no seed data
- [x] Decisions D1–D9 accepted or changed

---

## 7. Changes after approval (product owner, 2026-11-24)

| # | Change | Why / notes |
|---|---|---|
| C1 | Password made of whitespace only is rejected (422 "Password cannot consist of spaces only") | §3.3 says "at least 8 characters"; 8 spaces met it literally (QA observation) |
| C2 | Deleting a team or an epic asks for confirmation, like tickets (§6.7) | Every delete in the UI is now confirmed |
| C3 | Leaving with unsaved edits asks "Leave without saving changes?" — **Yes**: leave, nothing is saved; **No**: close the dialog, stay with the edits | Ticket form, epic panel, team rename/create, comment draft and comment edit. Links, header menu and browser Back (react-router `useBlocker`, so the app uses a data router); reload/close uses the browser's own prompt. Explicit Cancel/Esc does not ask. |
| C4 | **§14 stretch accepted:** edit and delete **own** comments. Migration 0007 adds `comments.edited_at`; UI shows "(edited)"; delete is confirmed; other users' comments → 403 and no buttons | §7.6 allows it as a stretch feature. Ticket `modified_at` stays unchanged (§7.5). Removed "comment edit/delete" from §5. |

# Full regression — §3–§11, DoD §13 — 2026-11-23

Tester: independent `qa-tester` agent (Playwright MCP + direct API calls). Screenshots: `screenshots/`.
**Result: 46 passed · 1 failed (low) · 5 not tested.**

## Summary by area

| Area | § | Result | Key evidence |
|---|---|---|---|
| Sign-up, email normalisation, password ≥ 8 | §3.1, §3.3 | PASS | AUTH-01.png, AUTH-02.png; duplicate in other case → 409 `email_taken` |
| Verification email, resend, single-use token | §3.4–§3.7 | PASS | AUTH-07/08/09.png; old link after resend → "replaced by a newer one"; reuse → 400 `token_used` |
| 24 h token expiry | §3.6 | NOT TESTED | needs clock/DB manipulation (covered by pytest `test_auth.py`) |
| Unverified login blocked, login, logout, 401s | §3.2, §3.5, §3.8 | PASS | AUTH-05.png; 12 protected endpoints → 401 after logout |
| No secrets in URLs / storage | §9.6 | PASS | httpOnly cookie, `document.cookie` empty, local/sessionStorage empty |
| Teams CRUD, unique ignoring case, 409 delete | §4.2–§4.5 | PASS | TEAMS-01/03/04.png, TEAMS-05-409-ui.png |
| Epics CRUD, team immutable, 409 delete | §5.2–§5.5, §5.8 | PASS | EPICS-00/01.png, EPICS-05-409-ui.png; PATCH `team_id` → 422 `epic_team_immutable` |
| Ticket fields, enums, backend validation | §6.1, §6.9 | PASS | TICKETS-01/02.png; bad enums/empty/extra fields → 422 |
| Same-team epic, team change clears epic | §5.7, §6.6 | PASS | TICKETS-06-team-change.png; mismatch → 422 `epic_team_mismatch` |
| Unchanged save keeps modified_at | §6.5 | PASS | API + UI "No changes to save." |
| Delete with confirmation, comments removed | §6.7 | PASS | TICKETS-07-delete-confirm.png |
| Comments: order, author, time, empty, immutable, modified_at | §7.1–§7.6 | PASS | COMMENTS-01.png; 20k-char comment renders |
| Board: columns, cards, order, open/create | §8.1–§8.3, §8.7, §8.8 | PASS | BOARD-01.png |
| Drag-and-drop persists after refresh | §6.8, §8.4, §8.6, DoD-6 | PASS | BOARD-04-dnd-persisted.png |
| Failed drop rolls back with error (404 and network abort) | §8.5 | PASS | BOARD-05-dnd-fail-404.png |
| Filters AND, case-insensitive search, Clear, count | §8.9 | PASS | BOARD-09-filters-and.png |
| 100+ tickets | §8.10 | NOT TESTED by agent | covered by `e2e/tests/large-board.spec.ts` (150 tickets) |
| Timestamps ISO-8601 UTC with Z | §9.5 | PASS | all responses |
| Loading / empty / success / error states | §11.3 | PASS (1 FAIL below) | double-clicks create one record |
| Restart persistence, clean checkout, fresh DB | §11.2, DoD-7, DoD-9 | NOT TESTED by agent | no shell access; DoD-9 checked separately by migrating a throwaway DB (0 rows) |

## Defects

| ID | Severity | Description | Status |
|---|---|---|---|
| BUG-regression-1 | Low | "Ticket #N created." notice reappeared on every refresh (kept in `history.state`) | **Fixed**: notice is removed from the history entry once shown; e2e `tickets.spec.ts` now reloads and asserts no notice |

## Observations (product-owner decisions, not defects)

1. A password of 8 spaces is accepted — literally meets §3.3. *Open.*
2. `POST /tickets` without `state` defaults to `new`. *Kept (documented).*
3. A failed drop on a ticket deleted elsewhere returns the card to its column until refresh (§8.5 wording). *Open.*
4. PATCH null messages used raw field names ("team_id cannot be empty"). **Fixed**: now "Team is required", "Type is required", …
5. Team/epic delete has no confirmation (only tickets need one, §6.7). *Open.*

## Test data

All QA teams, epics, tickets and comments were deleted by the tester. Two accounts remain (no account-delete API):
`qa-20261123t1708@example.com`, `qa-apisp-20261123t1708@example.com` (unverified).

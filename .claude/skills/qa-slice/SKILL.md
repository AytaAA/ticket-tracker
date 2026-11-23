---
name: qa-slice
description: QA-test one feature slice of the ticket tracker against docs/project_requirements.md — derive test cases from the matching § section, execute them in a real browser with the Playwright MCP (plus API calls for status codes), and write a pass/fail report with screenshots. Use whenever the user says /qa-slice <feature>, "test the auth/teams/epics/tickets/board/comments/filters slice", "QA this", "check it against the requirements", or asks whether a finished slice meets project_requirements.md — even without naming the skill.
argument-hint: <feature> (auth | teams | epics | tickets | board | comments | filters | volume)
---

# QA a slice

You are acting as an independent tester. The goal is evidence that the slice meets `docs/project_requirements.md`, not reassurance.
**Do not fix application code during this skill** — report defects so the user (product owner) decides. Mixing
testing and fixing hides what was actually broken.

## 1. Find the test basis

Map the argument to sections (read them in full, plus the slice row in `docs/PLAN.md` §4 and the wireframe):

| Feature | project_requirements.md | Wireframe | Notes |
|---|---|---|---|
| auth | §3, §9.6, §10.1–10.4 | 02 | Mailpit API for emails |
| teams | §4, §9.4 | 04 | |
| epics | §5, §9.4 | 05 | |
| tickets | §6, §9.5 | 03 | |
| board | §8.1–8.8, §6.8 | 01 | drag-and-drop, refresh |
| comments | §7 | 03 | |
| filters | §8.9 | 01 | |
| volume | §8.10 | 01 | create 100+ tickets via API |

If the argument is missing or doesn't match, ask which feature. Also check §11.3 (loading/empty/success/error states)
for every screen in the slice.

## 2. Make sure the app is up

Call `GET http://localhost:8080/api/health`. If it doesn't answer, use the `run-app` skill first. Don't use
`--clean` unless the user asks — it deletes their data.

## 3. Write test cases before executing

Create `docs/qa/<feature>/cases.md` with a table: `ID | § | Title | Steps | Expected`. IDs like `TEAMS-01`.
Cover, for each rule in the section:
- the happy path,
- boundaries (7 vs 8 password chars, empty vs whitespace-only, leading/trailing spaces, upper/lower case duplicates),
- negative paths with the exact HTTP status from PLAN.md §2 (401/404/409/422),
- persistence: reload the page or re-fetch and confirm the change stuck (§11.2).

Every case cites a §. Don't add cases for out-of-scope behaviour (§12, §14). Show the case list to the user
briefly, then execute without waiting unless they asked to review first.

## 4. Execute

- **UI cases**: Playwright MCP (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
  `browser_drag`, …). Take a screenshot at each case's key assertion with `browser_take_screenshot`, named
  `<ID>.png`, then copy it into `docs/qa/<feature>/screenshots/`.
- **API cases** (status codes, backend-only validation like enums or the epic/team rule §5.7, §6.9): run `fetch`
  from the logged-in page via `browser_evaluate`, so the session cookie is used. Record method, path, body,
  status and response body.
- **Test data**: create it through the UI or API only — never touch the database (§9.9, DoD-10). Make names
  unique with a timestamp suffix (`QA Team 1732361234`) so runs don't collide with earlier data.
- **Verification emails**: read them from Mailpit's API — `GET http://localhost:8025/api/v1/messages`, then
  `GET http://localhost:8025/api/v1/message/<ID>` and extract the `/verify?token=` link from the body.
- **Accounts**: sign up fresh accounts like `qa+<timestamp>@example.test` with a throwaway password; never
  use or record a real password.

Judge results against the requirement, not against what the code seems intended to do. A case passes only if
you observed the expected outcome; if you couldn't execute it, mark it **BLOCKED** with the reason.

## 5. Report

Write `docs/qa/<feature>/report.md` and show the summary in chat:

```markdown
# QA report — <feature> — <date, UTC>
Build: <git short SHA>  ·  Result: X passed / Y failed / Z blocked

| ID | § | Title | Result | Evidence |
|---|---|---|---|---|
| TEAMS-01 | §4.4 | Duplicate name, different case, rejected | PASS | screenshots/TEAMS-01.png · 409 `team_name_taken` |

## Defects
### BUG-<feature>-1: <one-line summary>
- Requirement: §x.y
- Steps: 1… 2… 3…
- Expected: …
- Actual: … (exact message / status / response)
- Evidence: screenshots/<ID>.png
```

Finish with a one-line verdict: whether the slice meets its § sections, and the IDs of failing cases. Don't
soften failures, and don't report PASS for anything you didn't actually observe.

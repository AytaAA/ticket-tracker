# QA report — auth — 2026-11-23 15:44 UTC
Build: `0e4e734`  ·  Result: **26 passed / 0 failed / 1 blocked**

Test basis: project_requirements.md §3, §9.6, §10.1–10.4, §11.3 · PLAN.md §2 · wireframe 02. Cases: [cases.md](cases.md).
Method: Playwright MCP against http://localhost:8080 (Chrome), API calls via `fetch` from the page, emails via the
Mailpit API. Test data made only through UI/API, accounts `qa+<timestamp>@example.test`. No DB access.

| ID | § | Title | Result | Evidence |
|---|---|---|---|---|
| AUTH-01 | §3.1, §10.1 | Sign up happy path (UI) | PASS | screenshots/AUTH-01.png · 201 `{id:7, email:"qa+1795448667275@example.test", verification_email_sent:true}` |
| AUTH-02 | §3.1 | Email trimmed + lowercased | PASS | typed `  QA+1795448667275@Example.TEST  ` → stored/shown `qa+1795448667275@example.test`; mail To = lowercased (AUTH-01.png) |
| AUTH-03 | §3.1 | Duplicate email, different case + spaces | PASS | screenshots/AUTH-03.png · 409 `email_taken` "An account with this email already exists." |
| AUTH-04 | §3.1 | Empty / whitespace-only / invalid email | PASS | `""` → 422 "Email is required" · `"   "` → 422 "Email is required" · `"no-at-sign"` → 422 "Enter a valid email address"; all `field: email` |
| AUTH-05 | §3.3 | 7-char password rejected | PASS | UI: "Password must be at least 8 characters." (screenshots/AUTH-07.png) · API: 422 `field: password` |
| AUTH-06 | §3.3 | 8-char password accepted | PASS | 201 for `12345678` |
| AUTH-07 | §10.1 | Confirm mismatch | PASS | screenshots/AUTH-07.png · "Passwords do not match."; 0 signup requests sent |
| AUTH-08 | §3.4 | Verification email via SMTP | PASS | Mailpit: 1 message to the address, subject "Verify your email for Ticket Tracker", from `no-reply@ticket-tracker.local`, body has `http://localhost:8080/verify?token=…` |
| AUTH-09 | §3.5 | Unverified login blocked | PASS | screenshots/AUTH-09.png · 403 `email_not_verified` "Please verify your email before logging in."; no Set-Cookie, cookie jar empty |
| AUTH-10 | §3.5, §3.8 | Unverified user can't reach app | PASS | /board → /login · `GET /api/auth/me` 401 `unauthenticated` |
| AUTH-11 | §3.6, §10.2 | Verify → success → login screen | PASS | screenshots/AUTH-11.png · "Email verified / Continue to login" → /login; `/api/auth/me` still 401 (no auto-login) |
| AUTH-12 | §3.6 | Link single-use | PASS | screenshots/AUTH-12.png · "Link already used"; API 400 `token_used` |
| AUTH-13 | §3.6 | Link expires after 24 h | **BLOCKED** | Can't wait 24 h and DB edits are not allowed in QA. Covered only by pytest `test_expired_token_is_rejected` / `test_verification_token_is_stored_hashed_and_expires_in_24h` (white-box) |
| AUTH-14 | §3.6 | Invalid / missing token | PASS | screenshots/AUTH-14.png · `?token=garbage` → "Invalid link … invalid or has been replaced by a newer one." + resend form; no token → "…missing its token." + resend form |
| AUTH-15 | §3.7, §10.3 | Resend from login invalidates old link | PASS | screenshots/AUTH-15.png, AUTH-15-old-link.png · 202; Mailpit count 1→2, links differ; old link → "Invalid link"; new link → verified |
| AUTH-16 | §3.7, §10.3 | Resend from verification-result screen | PASS | screenshots/AUTH-16.png · message shown, 2nd email arrived, its link verified |
| AUTH-17 | §3.7 | Resend with empty email | PASS | screenshots/AUTH-17.png · "Enter your email address first."; 0 requests sent |
| AUTH-18 | §3.2, §3.1 | Login with upper case + spaces | PASS | screenshots/AUTH-18.png · 200, landed on /board, menu shows lowercased email |
| AUTH-19 | §3.2 | Wrong password / unknown email | PASS | screenshots/AUTH-19.png · both 401 `invalid_credentials` "Incorrect email or password." (identical bodies) |
| AUTH-20 | §3.2 | Wrong password on unverified account | PASS | 401 `invalid_credentials` (not 403) |
| AUTH-21 | §11.2 | Session survives refresh | PASS | screenshots/AUTH-21.png · after reload still on /board, `/api/auth/me` 200 |
| AUTH-22 | §3.2, §15 | Log out via user menu | PASS | screenshots/AUTH-22-menu.png, AUTH-22.png · → /login; /board → /login; `/me` 401; replaying the old session id → 401 (session deleted server-side) |
| AUTH-23 | §3.8 | Protected API without session | PASS | `GET /me` 401, `POST /logout` 401, forged cookie `GET /me` 401 — all `unauthenticated` |
| AUTH-24 | §3.8 | Public endpoints work logged out | PASS | health 200, signup 201, verify 400 (bad token, not 401), resend 202, login 401 `invalid_credentials` (credentials, not session) |
| AUTH-25 | §9.6 | No session in URL; httpOnly cookie | PASS | cookie `session` httpOnly=true, SameSite=Lax; `document.cookie` = `""`; session value not in any URL |
| AUTH-26 | §3.3 | No password/hash in responses | PASS | no `argon2`, password or `password_hash` in any signup/login/me response body. (Storage hashing itself: pytest only) |
| AUTH-27 | §11.3 | Loading / error / success states | PASS | "Signing up…" + disabled button while pending; network failure → "Cannot reach the server. Check your connection and try again." (screenshots/AUTH-27.png); success alerts in AUTH-01/15/16 |

Console: only "Failed to load resource" entries for the deliberate 4xx / aborted requests; no JavaScript exceptions.

## Defects
None found.

## Observations (not defects — for the product owner)
1. **Sign-up reveals whether an email is registered** (409 `email_taken`). This is what PLAN.md §2 specifies, but it
   works against D8 (resend hides whether an email exists). Not required by project_requirements.md either way; decide whether that's acceptable.
2. **AUTH-13 (24 h expiry) is not black-box verified.** If you want UI evidence, you'd need a test-only hook to make a
   token expire early. That would be a new feature, so it's your call.
3. AUTH-25: Playwright doesn't expose the raw `Set-Cookie` header, so the httpOnly flag was checked through the browser's
   cookie store plus `document.cookie` being empty. The pytest suite checks the header itself.
4. QA runs leave test accounts in the app DB and emails in Mailpit (allowed by §9.9 / DoD-10).

**Verdict:** the auth slice meets §3, §9.6, §10.1–10.4 and §11.3 for every case that was executed. No failing cases.
AUTH-13 (24 h expiry) is BLOCKED for black-box testing and covered only by pytest.

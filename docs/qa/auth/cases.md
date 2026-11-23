# Test cases — auth (§3, §9.6, §10.1–10.4, §11.3)

Test basis: `docs/project_requirements.md` §3, §9.6, §10.1–10.4, §11.3 · `docs/PLAN.md` §2 (status codes), §4 slice 1 · wireframe 02.
Accounts: `qa+<timestamp>@example.test`, throwaway password. Emails read from the Mailpit API.

| ID | § | Title | Steps | Expected |
|---|---|---|---|---|
| AUTH-01 | §3.1, §10.1 | Sign up happy path (UI) | /signup → valid email, 8+ char password, matching confirm → Sign up | Success screen "Check your email" naming the address; API 201 |
| AUTH-02 | §3.1 | Email is trimmed and lowercased | Sign up with `  QA+ts@Example.TEST  ` | Success screen shows `qa+ts@example.test`; email arrives to lowercased address |
| AUTH-03 | §3.1 | Duplicate email, different case + spaces (UI) | Sign up again with upper-case/space-padded variant of an existing email | Error "An account with this email already exists."; API 409 `email_taken` |
| AUTH-04 | §3.1 | Invalid / empty / whitespace-only email (API) | POST /api/auth/signup with `""`, `"   "`, `"no-at-sign"` | 422, `field: email` for each |
| AUTH-05 | §3.3 | Password 7 chars rejected (UI + API) | UI: 7-char password; API: POST signup with 7 chars | UI field error "at least 8 characters"; API 422 `field: password` |
| AUTH-06 | §3.3 | Password exactly 8 chars accepted (API) | POST signup with 8-char password | 201 |
| AUTH-07 | §10.1 | Confirm password mismatch (UI) | Different confirm value → Sign up | "Passwords do not match."; no request sent / no account |
| AUTH-08 | §3.4 | Verification email sent via SMTP | After AUTH-01 check Mailpit | 1 message to the address, body contains `/verify?token=` link |
| AUTH-09 | §3.5 | Unverified user cannot log in (UI + API) | Log in with correct credentials before verifying | Error "Please verify your email before logging in."; API 403 `email_not_verified`; no session cookie |
| AUTH-10 | §3.5, §3.8 | Unverified user cannot reach the app | After AUTH-09 open /board; GET /api/auth/me | Redirected to /login; 401 |
| AUTH-11 | §3.6, §10.2 | Verify link → success → login screen | Open link from email | "Email verified" + "Continue to login" → /login; not auto-logged-in |
| AUTH-12 | §3.6 | Verification link is single-use | Open the same link again | Error screen "already been used"; API 400 `token_used` |
| AUTH-13 | §3.6 | Link expires after 24 h | Use a link older than 24 h | 400 `token_expired`, error screen with resend |
| AUTH-14 | §3.6 | Invalid / missing token | Open /verify?token=garbage and /verify | Error screen "Invalid link" + resend form |
| AUTH-15 | §3.7, §10.3 | Resend from login screen invalidates the old link | New unverified account → Login screen → enter email → Resend email | Success message; 2nd email in Mailpit; old link → "invalid or replaced"; new link verifies |
| AUTH-16 | §3.7, §10.3 | Resend from verification-result screen | Open invalid link → enter email → Resend email | Success message; new email arrives; new link verifies |
| AUTH-17 | §3.7 | Resend with empty email field (UI) | Login screen, empty email → Resend email | Validation message, nothing sent |
| AUTH-18 | §3.2, §3.1 | Log in with different case + spaces | Verified account, email typed `  UPPER  ` | Lands on /board, user menu shows lowercased email |
| AUTH-19 | §3.2 | Wrong password / unknown email | Log in with wrong password; unknown email | "Incorrect email or password." for both; API 401 `invalid_credentials` |
| AUTH-20 | §3.2 | Wrong password on unverified account | Unverified account + wrong password (API) | 401 (does not reveal "unverified") |
| AUTH-21 | §11.2 | Session survives refresh | Logged in → reload /board | Still logged in |
| AUTH-22 | §3.2, §15 | Log out via user menu | User menu → Log out | Back on /login; /board redirects to /login; /api/auth/me 401 |
| AUTH-23 | §3.8 | Protected API without session | GET /api/auth/me, POST /api/auth/logout without cookie; with forged cookie | 401 `unauthenticated` |
| AUTH-24 | §3.8 | Public endpoints work without session | signup/verify/resend/login/health called logged out | Not 401 |
| AUTH-25 | §9.6 | No session id in URL; cookie is httpOnly | Inspect URLs after login; `document.cookie`; Set-Cookie header | No session in any URL; `document.cookie` lacks `session`; HttpOnly flag set |
| AUTH-26 | §3.3 | Password not stored in plain text | Response bodies of signup/login | No password or hash in any response (DB check not allowed; hashing covered by pytest) |
| AUTH-27 | §11.3 | Loading / error / success states | Observe buttons while submitting; network-error message; success alerts | Buttons show "…ing" and disable; errors and successes shown |

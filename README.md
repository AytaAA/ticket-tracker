# Ticket Tracker

A small Kanban ticket tracker: sign up with email verification, manage teams and epics, create tickets,
drag them across a five-column board, and comment on them.

Three tiers, each in its own container:

| Container | What it is |
|---|---|
| `frontend` | React + TypeScript SPA, served by nginx on **http://localhost:8080**; nginx forwards `/api` to the backend |
| `backend` | Python FastAPI HTTP API; applies database migrations (Alembic) on every start |
| `db` | PostgreSQL 16; data is kept in the `db-data` Docker volume |
| `mailpit` | Local test mail server; every email the app sends appears at **http://localhost:8025** |

Requirements: [`docs/project_requirements.md`](docs/project_requirements.md). Design decisions and API: [`docs/PLAN.md`](docs/PLAN.md).

---

## Prerequisites

- **Docker with Docker Compose v2.24 or newer** (`docker compose version`). On Windows and macOS this is
  Docker Desktop. On Windows you can also use Docker Engine inside WSL 2 and run every command there.
- **Git**, to clone the repository.
- Free ports **8080** (app) and **8025** (Mailpit).

Nothing else needs to be installed to run the app. Node.js is only needed for the optional browser tests (see [Tests](#tests)).

---

## Start the application

From the repository root:

```bash
docker compose up --build
```

The first build takes a few minutes. The app is ready when the `frontend` container reports `healthy`
(`docker compose ps`), or add `-d --wait` to run in the background and return once everything is healthy:

```bash
docker compose up --build -d --wait
```

| URL | What |
|---|---|
| http://localhost:8080 | The app |
| http://localhost:8080/api/docs | Interactive API documentation (Swagger UI) |
| http://localhost:8025 | Mailpit inbox (verification emails) |

**No `.env` file is needed.** Every setting has a local default in `docker-compose.yml`. See
[Configuration](#configuration) to change one.

### Stop, restart, start from scratch

```bash
docker compose stop                 # stop; data is kept
docker compose up -d                # start again; data is still there
docker compose down                 # remove the containers; data is kept in the volume
docker compose down -v              # remove the containers AND the database volume
docker compose up --build -d --wait # rebuild after a code change
```

A fresh database contains only the schema and migration metadata. **There is no seed or demo data.**
Create everything through the app or the API.

---

## First steps

1. Open http://localhost:8080/signup and sign up with any email address, for example `qa1@example.com`.
   The password needs at least 8 characters.
2. Open Mailpit at http://localhost:8025, open the email "Verify your email for Ticket Tracker" and click the link.
3. Click **Continue to login** and log in.
4. **Teams** → **+ Create team**.
5. *(Optional)* **Epics** → choose the team → **+ Create epic**.
6. **Board** → **+ New ticket**, fill in the form, **Create**.
7. Back on the **Board**, drag the card to another column. The change is saved immediately.

If the verification link expired (after 24 hours) or was replaced, use **Resend email** on the login screen
or on the error page.

### Bulk test data (100+ tickets)

`scripts/bulk_tickets.py` creates tickets **through the API** for an account you have already verified.
It needs Python 3.10+ only (no packages) and asks for the password:

```bash
python scripts/bulk_tickets.py --email qa1@example.com --team "Load Test" --count 150
```

It creates the team if it doesn't exist, adds 3 epics and N tickets with random types, states and epics.
To run it without a prompt, set the password in the `TT_PASSWORD` environment variable.

---

## Configuration

Settings come from environment variables. Defaults are in `docker-compose.yml` (database) and
`backend/app/config.py` (everything else). To change something:

```bash
cp .env.example .env     # .env is git-ignored; never commit real credentials
# edit .env, then:
docker compose up --build -d --wait
```

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `tickets` / `tickets` / `change-me-local-only` | Database name and credentials (local container only). Changing them on an existing volume needs `docker compose down -v` first. |
| `APP_BASE_URL` | `http://localhost:8080` | Used to build the link in the verification email |
| `SMTP_HOST` / `SMTP_PORT` | `mailpit` / `1025` | Mail server for verification emails |
| `SMTP_USERNAME` / `SMTP_PASSWORD` | empty | SMTP login, only if the server needs it |
| `SMTP_STARTTLS` | `false` | Use STARTTLS |
| `SMTP_FROM` | `no-reply@ticket-tracker.local` | Sender address |
| `COOKIE_SECURE` | `false` | Set to `true` only when the app is served over HTTPS |

### Sending real email through the company relay

Mailpit catches all email by default. To send through `relay1.dataart.com` (reachable only from the DataArt
network/VPN), put this in `.env`:

```bash
SMTP_HOST=relay1.dataart.com
SMTP_PORT=25
SMTP_STARTTLS=false
SMTP_FROM=<a sender address the relay accepts>
```

Port and sender are not confirmed; check them with IT. If sending fails, sign-up still succeeds, the error is
logged (`docker compose logs backend`), and the user can use **Resend email**.

---

## Tests

### Backend (pytest)

Business rules: auth and verification, teams, epics, tickets, comments, 409 conflicts, `modified_at` rules.
The tests use a separate `<db>_test` database, so they never touch the app's data.

```bash
docker compose exec backend pytest                                  # all
docker compose exec backend pytest tests/test_tickets.py            # one file
docker compose exec backend pytest tests/test_tickets.py -k modified  # by name
```

### End-to-end (Playwright)

Real browser flows against the running stack: sign up via Mailpit, teams, epics, tickets, comments,
drag-and-drop with persistence and rollback, filters, and a 150-ticket board. Needs **Node.js 18+**.
The tests create their own users and data with unique names and delete the teams, epics and tickets they create.

```bash
cd e2e
npm ci
npx playwright test                         # uses your installed Google Chrome
npx playwright test tests/board.spec.ts     # one file
npx playwright test -g "drag"               # by test name
npx playwright show-report                  # HTML report of the last run
```

No Chrome installed? Use Playwright's own Chromium:

```bash
npx playwright install chromium
PW_CHANNEL= npx playwright test            # PowerShell: $env:PW_CHANNEL=""; npx playwright test
```

Other URLs: set `BASE_URL` (default `http://localhost:8080`) and `MAILPIT_URL` (default `http://localhost:8025`).

QA reports with screenshots are in [`docs/qa/`](docs/qa/).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` for 8080 or 8025 | Stop whatever uses the port, or change the left side of `ports:` in `docker-compose.yml` (and `APP_BASE_URL`). |
| No verification email | Check Mailpit at http://localhost:8025 and `docker compose logs backend`. Use **Resend email**. |
| `env_file` / `required` error from Compose | Your Docker Compose is older than v2.24. Update Docker Desktop / Compose. |
| Backend not healthy | `docker compose logs backend`. A failing migration shows here. |
| Want a completely empty database | `docker compose down -v && docker compose up --build -d --wait` |

---

## Project layout

```
backend/            FastAPI app (app/), Alembic migrations (alembic/versions/), pytest tests (tests/)
frontend/           React + TypeScript + Vite SPA (src/), nginx config
e2e/                Playwright end-to-end tests
scripts/            bulk_tickets.py (test data through the API)
docs/               project_requirements.md (requirements), PLAN.md (design), wireframes/, qa/ (test reports)
docker-compose.yml  the four services
.env.example        optional settings, with placeholders only
```

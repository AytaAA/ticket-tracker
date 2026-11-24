"""§3 User accounts and authentication — business rules (PLAN.md §4 slice 1)."""

import uuid
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import text

from app.db import engine
from app.security import utcnow

PASSWORD = "secret-pw-1"


def signup(client, email="alice@example.com", password=PASSWORD):
    return client.post("/api/auth/signup", json={"email": email, "password": password})


def signup_and_verify(client, outbox, email="alice@example.com"):
    assert signup(client, email).status_code == 201
    assert client.post("/api/auth/verify", json={"token": outbox[-1][1]}).status_code == 200


def login(client, email="alice@example.com", password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def db_one(sql, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).one()


# ---------- §3.1 sign-up, email normalisation ----------


def test_signup_trims_and_lowercases_email(client, outbox):
    r = signup(client, "  Alice@Example.COM  ")
    assert r.status_code == 201
    assert r.json()["email"] == "alice@example.com"
    assert r.json()["verification_email_sent"] is True
    assert outbox[0][0] == "alice@example.com"
    assert db_one("SELECT email, is_verified FROM users") == ("alice@example.com", False)


@pytest.mark.parametrize("variant", ["alice@example.com", "ALICE@example.com", "  alice@EXAMPLE.com "])
def test_signup_duplicate_email_ignoring_case_and_spaces_is_409(client, outbox, variant):
    assert signup(client, "alice@example.com").status_code == 201
    r = signup(client, variant)
    assert r.status_code == 409
    assert r.json()["code"] == "email_taken"


@pytest.mark.parametrize("email", ["", "   ", "no-at-sign", "a@b", "two@@example.com", "sp ace@example.com"])
def test_signup_invalid_email_is_422(client, outbox, email):
    r = signup(client, email)
    assert r.status_code == 422
    assert r.json()["field"] == "email"
    assert outbox == []


# ---------- §3.3 password rules ----------


def test_password_shorter_than_8_is_422_and_8_is_accepted(client, outbox):
    r = signup(client, password="1234567")
    assert r.status_code == 422
    assert r.json()["field"] == "password"
    assert "8 characters" in r.json()["message"]
    assert signup(client, password="12345678").status_code == 201


def test_password_is_stored_as_argon2id_hash(client, outbox):
    signup(client)
    (stored,) = db_one("SELECT password_hash FROM users")
    assert stored != PASSWORD
    assert PASSWORD not in stored
    assert stored.startswith("$argon2id$")


# ---------- §3.4 / §3.6 verification ----------


def test_verification_token_is_stored_hashed_and_expires_in_24h(client, outbox):
    signup(client)
    token = outbox[0][1]
    token_hash, expires_at = db_one("SELECT token_hash, expires_at FROM email_verification_tokens")
    assert token_hash != token
    assert timedelta(hours=23, minutes=59) < expires_at - utcnow() <= timedelta(hours=24)


def test_verify_then_token_is_single_use(client, outbox):
    signup(client)
    token = outbox[0][1]
    assert client.post("/api/auth/verify", json={"token": token}).status_code == 200
    assert db_one("SELECT is_verified FROM users") == (True,)
    r = client.post("/api/auth/verify", json={"token": token})
    assert r.status_code == 400
    assert r.json()["code"] == "token_used"


def test_expired_token_is_rejected(client, outbox):
    signup(client)
    with engine.begin() as conn:
        conn.execute(text("UPDATE email_verification_tokens SET expires_at = now() - interval '1 second'"))
    r = client.post("/api/auth/verify", json={"token": outbox[0][1]})
    assert r.status_code == 400
    assert r.json()["code"] == "token_expired"
    assert db_one("SELECT is_verified FROM users") == (False,)


def test_unknown_token_is_rejected(client, outbox):
    r = client.post("/api/auth/verify", json={"token": "not-a-real-token"})
    assert r.status_code == 400
    assert r.json()["code"] == "token_invalid"


# ---------- §3.7 resend ----------


def age_tokens(seconds=61):
    """Pretend the last verification email went out `seconds` ago (resend cooldown is 60 s)."""
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE email_verification_tokens SET created_at = created_at - make_interval(secs => :s)"),
            {"s": seconds},
        )


def test_resend_issues_new_token_and_invalidates_old_one(client, outbox):
    signup(client)
    old = outbox[0][1]
    age_tokens()
    r = client.post("/api/auth/resend-verification", json={"email": " ALICE@example.com "})
    assert r.status_code == 202
    new = outbox[1][1]
    assert new != old
    assert client.post("/api/auth/verify", json={"token": old}).json()["code"] == "token_invalid"
    assert client.post("/api/auth/verify", json={"token": new}).status_code == 200


def test_resend_after_expiry_gives_a_working_token(client, outbox):
    signup(client)
    with engine.begin() as conn:
        conn.execute(text("UPDATE email_verification_tokens SET expires_at = now() - interval '1 second'"))
    age_tokens(24 * 3600)  # an expired link was sent a day ago
    client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})
    assert client.post("/api/auth/verify", json={"token": outbox[-1][1]}).status_code == 200


def test_resend_does_not_reveal_whether_email_exists(client, outbox):
    signup_and_verify(client, outbox)
    sent_before = len(outbox)
    unknown = client.post("/api/auth/resend-verification", json={"email": "nobody@example.com"})
    verified = client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})
    assert unknown.status_code == verified.status_code == 202
    assert unknown.json() == verified.json()
    assert len(outbox) == sent_before  # nothing sent to unknown or already-verified users


def test_resend_with_malformed_email_is_422(client, outbox):
    assert client.post("/api/auth/resend-verification", json={"email": "nope"}).status_code == 422


# ---------- §3.2 / §3.5 login, logout ----------


def test_unverified_user_cannot_log_in(client, outbox):
    signup(client)
    r = login(client)
    assert r.status_code == 403
    assert r.json()["code"] == "email_not_verified"
    assert "session" not in r.cookies


def test_wrong_password_for_unverified_user_is_401_not_403(client, outbox):
    """Don't tell a stranger the account exists but is unverified."""
    signup(client)
    assert login(client, password="wrong-password").status_code == 401


@pytest.mark.parametrize(
    "email,password", [("alice@example.com", "wrong-password"), ("nobody@example.com", PASSWORD)]
)
def test_bad_credentials_are_401_with_same_message(client, outbox, email, password):
    signup_and_verify(client, outbox)
    r = login(client, email, password)
    assert r.status_code == 401
    assert r.json() == {"code": "invalid_credentials", "message": "Incorrect email or password."}


def test_login_sets_httponly_cookie_and_me_works(client, outbox):
    signup_and_verify(client, outbox)
    r = login(client, "  ALICE@Example.com ")
    assert r.status_code == 200
    assert r.json() == {"id": 1, "email": "alice@example.com"}
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=lax" in set_cookie
    # session id is stored hashed, not raw
    (id_hash,) = db_one("SELECT id_hash FROM sessions")
    assert id_hash != client.cookies["session"]
    assert client.get("/api/auth/me").json() == {"id": 1, "email": "alice@example.com"}


def test_logout_ends_the_session(client, outbox):
    signup_and_verify(client, outbox)
    login(client)
    sid = client.cookies["session"]
    assert client.post("/api/auth/logout").status_code == 204
    # even if the old cookie is replayed, the session is gone server-side
    client.cookies.set("session", sid)
    assert client.get("/api/auth/me").status_code == 401
    assert db_one("SELECT count(*) FROM sessions") == (0,)


def test_expired_session_is_401(client, outbox):
    signup_and_verify(client, outbox)
    login(client)
    with engine.begin() as conn:
        conn.execute(text("UPDATE sessions SET expires_at = now() - interval '1 second'"))
    assert client.get("/api/auth/me").status_code == 401


# ---------- §3.8 protected endpoints ----------


@pytest.mark.parametrize("cookie", [None, "garbage"])
def test_protected_endpoints_return_401_without_valid_session(client, cookie):
    if cookie:
        client.cookies.set("session", cookie)
    for method, path in [("GET", "/api/auth/me"), ("POST", "/api/auth/logout")]:
        r = client.request(method, path)
        assert r.status_code == 401, path
        assert r.json()["code"] == "unauthenticated"


# ---------- §3.4 real SMTP (Mailpit) ----------

MAILPIT = "http://mailpit:8025"


def test_signup_sends_real_email_through_smtp_and_link_verifies(client):
    email = f"smtp-{uuid.uuid4().hex[:8]}@example.com"
    r = signup(client, email)
    assert r.json()["verification_email_sent"] is True

    found = httpx.get(f"{MAILPIT}/api/v1/search", params={"query": f"to:{email}"}).json()
    assert found["messages_count"] == 1
    msg = httpx.get(f"{MAILPIT}/api/v1/message/{found['messages'][0]['ID']}").json()
    body = msg["Text"]
    assert "/verify?token=" in body
    token = body.split("/verify?token=")[1].split()[0]
    assert client.post("/api/auth/verify", json={"token": token}).status_code == 200
    assert login(client, email).status_code == 200


def test_signup_still_succeeds_when_smtp_is_down(client, monkeypatch):
    monkeypatch.setattr("app.mailer.settings.smtp_host", "smtp.invalid")
    r = signup(client)
    assert r.status_code == 201
    assert r.json()["verification_email_sent"] is False


# ---------- §3.3 + product-owner decision 2026-11-24: whitespace-only password ----------


@pytest.mark.parametrize("password", [" " * 8, " " * 20, chr(9) * 8, " " + chr(9) + " " + chr(10) + "    "])
def test_whitespace_only_password_is_422(client, outbox, password):
    r = signup(client, "spaces@example.com", password)
    assert r.status_code == 422
    assert r.json()["field"] == "password"
    assert r.json()["message"] == "Password cannot consist of spaces only"
    assert outbox == []


def test_password_with_spaces_inside_is_fine(client, outbox):
    assert signup(client, "spaces@example.com", "  my pass  ").status_code == 201


# ---------- security review SEC-1 (product owner 2026-11-24): 60-second resend cooldown ----------


def test_resend_within_60_seconds_sends_nothing_and_keeps_the_link(client, outbox):
    signup(client)
    first = outbox[0][1]
    r = client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})
    assert r.status_code == 202  # same answer as always (D8)
    assert len(outbox) == 1  # nothing sent
    for _ in range(5):  # hammering doesn't help
        client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})
    assert len(outbox) == 1
    assert client.post("/api/auth/verify", json={"token": first}).status_code == 200  # first link still valid


def test_resend_after_60_seconds_sends_again(client, outbox):
    signup(client)
    age_tokens(59)
    client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})
    assert len(outbox) == 1
    age_tokens(2)  # now 61 s ago
    client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})
    assert len(outbox) == 2
    client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})  # cooldown starts again
    assert len(outbox) == 2


def test_cooldown_answer_is_the_same_for_unknown_emails(client, outbox):
    signup(client)
    cooling = client.post("/api/auth/resend-verification", json={"email": "alice@example.com"})
    unknown = client.post("/api/auth/resend-verification", json={"email": "nobody@example.com"})
    assert cooling.status_code == unknown.status_code == 202
    assert cooling.json() == unknown.json()

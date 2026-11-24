"""Fixes from the code + security review, 2026-11-24."""

import threading

from sqlalchemy import text

from app.db import engine


# ---------- CSRF guard (security review #3) ----------


def test_cross_origin_state_change_is_refused(auth_client):
    r = auth_client.post("/api/teams", json={"name": "X"}, headers={"Origin": "http://evil.localhost:3000"})
    assert r.status_code == 403
    assert r.json()["code"] == "cross_origin"
    team = auth_client.post("/api/teams", json={"name": "Y"}).json()
    r = auth_client.delete(f"/api/teams/{team['id']}", headers={"Origin": "http://localhost:9999"})
    assert r.status_code == 403
    assert len(auth_client.get("/api/teams").json()) == 1  # nothing created or deleted


def test_same_origin_state_change_is_allowed(auth_client):
    # TestClient's Host is "testserver"; a browser on the same site sends a matching Origin
    r = auth_client.post("/api/teams", json={"name": "Same"}, headers={"Origin": "http://testserver"})
    assert r.status_code == 201


def test_non_json_body_is_refused(auth_client):
    for ctype in ["text/plain", "application/x-www-form-urlencoded", None]:
        headers = {"Content-Type": ctype} if ctype else {}
        r = auth_client.post("/api/teams", content=b'{"name": "Sneaky"}', headers=headers)
        assert r.status_code == 415, ctype
    assert auth_client.get("/api/teams").json() == []


def test_get_requests_are_not_affected(auth_client):
    assert auth_client.get("/api/teams", headers={"Origin": "http://elsewhere"}).status_code == 200


# ---------- signup race (code review) ----------


def test_simultaneous_signups_give_one_201_and_one_409(client, outbox):
    """Two requests for the same email at the same moment: never a 500."""
    barrier = threading.Barrier(2)
    statuses: list[int] = []

    def go():
        barrier.wait()
        r = client.post("/api/auth/signup", json={"email": "race@example.com", "password": "secret-pw-1"})
        statuses.append(r.status_code)

    threads = [threading.Thread(target=go) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(statuses) == [201, 409]
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM users WHERE email = 'race@example.com'")) == 1


def test_signup_reports_link_lifetime(client, outbox):
    r = client.post("/api/auth/signup", json={"email": "life@example.com", "password": "secret-pw-1"})
    assert r.json()["verification_link_hours"] == 24

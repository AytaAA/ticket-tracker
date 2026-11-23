"""Tests run against a separate database (`<POSTGRES_DB>_test`) so they never leave users,
teams or tickets in the app's own database (§9.9). It is created and migrated here,
before any `app.*` module reads DATABASE_URL."""

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

_dev_url = make_url(os.environ["DATABASE_URL"])
_test_url = _dev_url.set(database=f"{_dev_url.database}_test")

_admin = create_engine(_dev_url, isolation_level="AUTOCOMMIT")
with _admin.connect() as conn:
    if not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": _test_url.database}):
        conn.execute(text(f'CREATE DATABASE "{_test_url.database}"'))
_admin.dispose()

os.environ["DEV_DATABASE_URL"] = _dev_url.render_as_string(hide_password=False)
os.environ["DATABASE_URL"] = _test_url.render_as_string(hide_password=False)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

command.upgrade(Config("alembic.ini"), "head")

from fastapi.testclient import TestClient  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE users, teams RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def outbox(monkeypatch):
    """Captures verification emails instead of sending them: list of (to, token)."""
    sent: list[tuple[str, str]] = []

    def fake_send(to: str, token: str) -> bool:
        sent.append((to, token))
        return True

    monkeypatch.setattr("app.auth.send_verification_email", fake_send)
    return sent


@pytest.fixture
def auth_client(client, outbox):
    """A TestClient logged in as a verified user (session cookie kept by the client)."""
    email, password = "member@example.com", "secret-pw-1"
    assert client.post("/api/auth/signup", json={"email": email, "password": password}).status_code == 201
    assert client.post("/api/auth/verify", json={"token": outbox[-1][1]}).status_code == 200
    assert client.post("/api/auth/login", json={"email": email, "password": password}).status_code == 200
    return client

"""§7 Comments — business rules (PLAN.md §4 slice 6), plus §6.7 cascade on ticket delete."""

import re
import time

import pytest
from sqlalchemy import text

from app.db import engine

ISO_Z = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")


@pytest.fixture
def ticket(auth_client):
    team = auth_client.post("/api/teams", json={"name": "Payments"}).json()
    return auth_client.post(
        "/api/tickets", json={"team_id": team["id"], "type": "bug", "title": "T", "body": "B"}
    ).json()


def add(client, ticket_id, body):
    return client.post(f"/api/tickets/{ticket_id}/comments", json={"body": body})


def test_comments_require_session(client):
    assert client.get("/api/tickets/1/comments").status_code == 401
    assert client.post("/api/tickets/1/comments", json={"body": "x"}).status_code == 401


def test_add_comment_has_all_fields(auth_client, ticket):
    r = add(auth_client, ticket["id"], "  Reproduced in Chrome.  ")
    assert r.status_code == 201
    c = r.json()
    assert set(c) == {"id", "ticket_id", "author", "body", "created_at"}  # §7.2
    assert c["ticket_id"] == ticket["id"]
    assert c["author"]["email"] == "member@example.com"
    assert c["body"] == "Reproduced in Chrome."
    assert ISO_Z.match(c["created_at"])


@pytest.mark.parametrize("body", ["", "   ", "\n\t"])
def test_empty_comment_is_422(auth_client, ticket, body):
    r = add(auth_client, ticket["id"], body)
    assert r.status_code == 422
    assert r.json()["field"] == "body"
    assert r.json()["message"] == "Comment cannot be empty"


def test_comment_on_missing_ticket_is_404(auth_client):
    assert add(auth_client, 999, "hello").status_code == 404
    assert auth_client.get("/api/tickets/999/comments").status_code == 404


def test_comments_oldest_first(auth_client, ticket):
    for body in ["first", "second", "third"]:
        add(auth_client, ticket["id"], body)
    r = auth_client.get(f"/api/tickets/{ticket['id']}/comments")
    assert r.status_code == 200
    assert [c["body"] for c in r.json()] == ["first", "second", "third"]


def test_adding_comment_does_not_change_ticket_modified_at(auth_client, ticket):
    """§7.5 / §6.1: and therefore not the board order."""
    time.sleep(0.01)
    add(auth_client, ticket["id"], "a comment")
    after = auth_client.get(f"/api/tickets/{ticket['id']}").json()
    assert after["modified_at"] == ticket["modified_at"]


def test_comments_are_immutable(auth_client, ticket):
    """§7.6: no edit or delete endpoints."""
    c = add(auth_client, ticket["id"], "fixed").json()
    assert auth_client.patch(f"/api/tickets/{ticket['id']}/comments/{c['id']}", json={"body": "x"}).status_code in (404, 405)
    assert auth_client.delete(f"/api/tickets/{ticket['id']}/comments/{c['id']}").status_code in (404, 405)


def test_deleting_ticket_deletes_its_comments(auth_client, ticket):
    """§6.7."""
    add(auth_client, ticket["id"], "one")
    add(auth_client, ticket["id"], "two")
    assert auth_client.delete(f"/api/tickets/{ticket['id']}").status_code == 204
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM comments")) == 0


def test_other_users_comment_shows_its_author(auth_client, outbox, ticket):
    add(auth_client, ticket["id"], "by member")
    auth_client.post("/api/auth/logout")
    auth_client.post("/api/auth/signup", json={"email": "second@example.com", "password": "secret-pw-2"})
    auth_client.post("/api/auth/verify", json={"token": outbox[-1][1]})
    auth_client.post("/api/auth/login", json={"email": "second@example.com", "password": "secret-pw-2"})
    add(auth_client, ticket["id"], "by second")
    authors = [c["author"]["email"] for c in auth_client.get(f"/api/tickets/{ticket['id']}/comments").json()]
    assert authors == ["member@example.com", "second@example.com"]

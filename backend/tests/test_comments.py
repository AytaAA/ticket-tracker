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
    assert set(c) == {"id", "ticket_id", "author", "body", "created_at", "edited_at"}  # §7.2 (+ edited_at)
    assert c["edited_at"] is None
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


def login_as_second_user(client, outbox):
    client.post("/api/auth/logout")
    client.post("/api/auth/signup", json={"email": "second@example.com", "password": "secret-pw-2"})
    client.post("/api/auth/verify", json={"token": outbox[-1][1]})
    client.post("/api/auth/login", json={"email": "second@example.com", "password": "secret-pw-2"})


# ---------- §14 stretch (requested 2026-11-24): edit / delete OWN comments ----------


def test_author_can_edit_own_comment(auth_client, ticket):
    c = add(auth_client, ticket["id"], "typo hre").json()
    r = auth_client.patch(f"/api/tickets/{ticket['id']}/comments/{c['id']}", json={"body": "  typo here  "})
    assert r.status_code == 200
    out = r.json()
    assert out["body"] == "typo here"
    assert ISO_Z.match(out["edited_at"])
    assert out["created_at"] == c["created_at"]
    listed = auth_client.get(f"/api/tickets/{ticket['id']}/comments").json()
    assert [x["body"] for x in listed] == ["typo here"]


def test_edit_with_same_text_keeps_edited_at_empty(auth_client, ticket):
    c = add(auth_client, ticket["id"], "same").json()
    r = auth_client.patch(f"/api/tickets/{ticket['id']}/comments/{c['id']}", json={"body": " same "})
    assert r.status_code == 200 and r.json()["edited_at"] is None


@pytest.mark.parametrize("body", ["", "   "])
def test_edit_to_empty_is_422(auth_client, ticket, body):
    c = add(auth_client, ticket["id"], "text").json()
    r = auth_client.patch(f"/api/tickets/{ticket['id']}/comments/{c['id']}", json={"body": body})
    assert r.status_code == 422 and r.json()["field"] == "body"


def test_author_can_delete_own_comment(auth_client, ticket):
    keep = add(auth_client, ticket["id"], "keep").json()
    gone = add(auth_client, ticket["id"], "gone").json()
    assert auth_client.delete(f"/api/tickets/{ticket['id']}/comments/{gone['id']}").status_code == 204
    listed = auth_client.get(f"/api/tickets/{ticket['id']}/comments").json()
    assert [x["id"] for x in listed] == [keep["id"]]


def test_edit_and_delete_do_not_change_ticket_modified_at(auth_client, ticket):
    """§7.5 spirit: comment activity never reorders the board."""
    c = add(auth_client, ticket["id"], "a").json()
    time.sleep(0.01)
    auth_client.patch(f"/api/tickets/{ticket['id']}/comments/{c['id']}", json={"body": "b"})
    auth_client.delete(f"/api/tickets/{ticket['id']}/comments/{c['id']}")
    assert auth_client.get(f"/api/tickets/{ticket['id']}").json()["modified_at"] == ticket["modified_at"]


def test_other_users_comment_cannot_be_edited_or_deleted(auth_client, outbox, ticket):
    c = add(auth_client, ticket["id"], "mine").json()
    login_as_second_user(auth_client, outbox)
    r = auth_client.patch(f"/api/tickets/{ticket['id']}/comments/{c['id']}", json={"body": "hijacked"})
    assert r.status_code == 403
    assert r.json()["code"] == "not_comment_author"
    assert auth_client.delete(f"/api/tickets/{ticket['id']}/comments/{c['id']}").status_code == 403
    assert auth_client.get(f"/api/tickets/{ticket['id']}/comments").json()[0]["body"] == "mine"


def test_missing_or_mismatched_comment_is_404(auth_client, ticket):
    c = add(auth_client, ticket["id"], "x").json()
    assert auth_client.patch(f"/api/tickets/{ticket['id']}/comments/999", json={"body": "y"}).status_code == 404
    assert auth_client.delete(f"/api/tickets/{ticket['id']}/comments/999").status_code == 404
    # right comment id, wrong ticket in the URL
    assert auth_client.delete(f"/api/tickets/{ticket['id'] + 1}/comments/{c['id']}").status_code == 404


def test_edit_delete_require_session(client):
    assert client.patch("/api/tickets/1/comments/1", json={"body": "x"}).status_code == 401
    assert client.delete("/api/tickets/1/comments/1").status_code == 401


def test_deleting_ticket_deletes_its_comments(auth_client, ticket):
    """§6.7."""
    add(auth_client, ticket["id"], "one")
    add(auth_client, ticket["id"], "two")
    assert auth_client.delete(f"/api/tickets/{ticket['id']}").status_code == 204
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT count(*) FROM comments")) == 0


def test_other_users_comment_shows_its_author(auth_client, outbox, ticket):
    add(auth_client, ticket["id"], "by member")
    login_as_second_user(auth_client, outbox)
    add(auth_client, ticket["id"], "by second")
    authors = [c["author"]["email"] for c in auth_client.get(f"/api/tickets/{ticket['id']}/comments").json()]
    assert authors == ["member@example.com", "second@example.com"]

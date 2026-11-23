"""§4 Teams — business rules (PLAN.md §4 slice 2).
The §4.5 delete-blocked (409) case needs epics/tickets; it is added in slices 3 and 4."""

import re
import time

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine

ISO_Z = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")


def create(client, name):
    return client.post("/api/teams", json={"name": name})


# ---------- §3.8 / §4.2 authentication ----------


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("GET", "/api/teams", None),
        ("POST", "/api/teams", {"name": "X"}),
        ("PATCH", "/api/teams/1", {"name": "X"}),
        ("DELETE", "/api/teams/1", None),
    ],
)
def test_teams_require_session(client, method, path, body):
    r = client.request(method, path, json=body)
    assert r.status_code == 401
    assert r.json()["code"] == "unauthenticated"


# ---------- §4.2 / §4.3 create + list ----------


def test_create_team_returns_all_fields(auth_client):
    r = create(auth_client, "Payments")
    assert r.status_code == 201
    team = r.json()
    assert set(team) == {"id", "name", "ticket_count", "epic_count", "created_at", "modified_at"}
    assert team["name"] == "Payments"
    assert (team["ticket_count"], team["epic_count"]) == (0, 0)
    assert ISO_Z.match(team["created_at"]) and ISO_Z.match(team["modified_at"])
    assert team["created_at"] == team["modified_at"]


def test_create_team_trims_name(auth_client):
    assert create(auth_client, "   Mobile Apps  ").json()["name"] == "Mobile Apps"


@pytest.mark.parametrize("name", ["", "   ", "\t\n"])
def test_create_team_empty_name_is_422(auth_client, name):
    r = create(auth_client, name)
    assert r.status_code == 422
    assert r.json()["field"] == "name"
    assert r.json()["message"] == "Team name is required"


def test_create_team_too_long_name_is_422(auth_client):
    assert create(auth_client, "x" * 101).status_code == 422
    assert create(auth_client, "x" * 100).status_code == 201


@pytest.mark.parametrize("variant", ["Payments", "payments", "PAYMENTS", "  pAyMeNtS  "])
def test_create_duplicate_name_ignoring_case_and_spaces_is_409(auth_client, variant):
    assert create(auth_client, "Payments").status_code == 201
    r = create(auth_client, variant)
    assert r.status_code == 409
    assert r.json()["code"] == "team_name_taken"
    assert "already exists" in r.json()["message"]


def test_list_teams_sorted_by_name_ignoring_case(auth_client):
    for name in ["mobile", "Internal Tools", "Payments"]:
        create(auth_client, name)
    r = auth_client.get("/api/teams")
    assert r.status_code == 200
    assert [t["name"] for t in r.json()] == ["Internal Tools", "mobile", "Payments"]


def test_db_rejects_case_insensitive_duplicate_and_untrimmed_names():
    """§4.4 enforced by the database too, not only by the API."""
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO teams (name) VALUES ('Core')"))
    for bad in ["CORE", " padded ", ""]:
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text("INSERT INTO teams (name) VALUES (:n)"), {"n": bad})


# ---------- §4.2 rename ----------


def test_rename_team_updates_modified_at_only(auth_client):
    team = create(auth_client, "Payments").json()
    time.sleep(0.01)
    r = auth_client.patch(f"/api/teams/{team['id']}", json={"name": "  Billing "})
    assert r.status_code == 200
    renamed = r.json()
    assert renamed["name"] == "Billing"
    assert renamed["created_at"] == team["created_at"]
    assert renamed["modified_at"] > team["modified_at"]


def test_rename_to_same_name_keeps_modified_at(auth_client):
    team = create(auth_client, "Payments").json()
    time.sleep(0.01)
    r = auth_client.patch(f"/api/teams/{team['id']}", json={"name": " Payments "})
    assert r.status_code == 200
    assert r.json()["modified_at"] == team["modified_at"]


def test_rename_own_name_to_different_case_is_allowed(auth_client):
    team = create(auth_client, "payments").json()
    r = auth_client.patch(f"/api/teams/{team['id']}", json={"name": "Payments"})
    assert r.status_code == 200
    assert r.json()["name"] == "Payments"


def test_rename_to_other_teams_name_is_409(auth_client):
    create(auth_client, "Payments")
    other = create(auth_client, "Mobile").json()
    r = auth_client.patch(f"/api/teams/{other['id']}", json={"name": "PAYMENTS"})
    assert r.status_code == 409
    assert r.json()["code"] == "team_name_taken"
    assert auth_client.get("/api/teams").json()[0]["name"] == "Mobile"


def test_rename_to_empty_is_422(auth_client):
    team = create(auth_client, "Payments").json()
    assert auth_client.patch(f"/api/teams/{team['id']}", json={"name": "  "}).status_code == 422


def test_rename_missing_team_is_404(auth_client):
    r = auth_client.patch("/api/teams/999", json={"name": "X"})
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"


# ---------- §4.2 / §4.5 delete ----------


def test_delete_empty_team(auth_client):
    team = create(auth_client, "Payments").json()
    assert auth_client.delete(f"/api/teams/{team['id']}").status_code == 204
    assert auth_client.get("/api/teams").json() == []
    # name is free again
    assert create(auth_client, "payments").status_code == 201


def test_delete_missing_team_is_404(auth_client):
    assert auth_client.delete("/api/teams/999").status_code == 404


# ---------- §4.6 all verified users manage all teams ----------


def test_other_user_sees_and_manages_same_teams(auth_client, outbox):
    team = create(auth_client, "Payments").json()
    auth_client.post("/api/auth/logout")
    email, pw = "second@example.com", "secret-pw-2"
    auth_client.post("/api/auth/signup", json={"email": email, "password": pw})
    auth_client.post("/api/auth/verify", json={"token": outbox[-1][1]})
    auth_client.post("/api/auth/login", json={"email": email, "password": pw})
    assert [t["id"] for t in auth_client.get("/api/teams").json()] == [team["id"]]
    assert auth_client.patch(f"/api/teams/{team['id']}", json={"name": "Renamed"}).status_code == 200

"""§5 Epics — business rules (PLAN.md §4 slice 3), plus the §4.5 team-delete guard for epics.
§5.7 (ticket epic must be same team) and the §5.8 409 need tickets; they come with slice 4."""

import re
import time

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine

ISO_Z = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")


@pytest.fixture
def team(auth_client):
    return auth_client.post("/api/teams", json={"name": "Payments"}).json()


@pytest.fixture
def other_team(auth_client):
    return auth_client.post("/api/teams", json={"name": "Mobile"}).json()


def create(client, team_id, title="Checkout reliability", description=None):
    body = {"team_id": team_id, "title": title}
    if description is not None:
        body["description"] = description
    return client.post("/api/epics", json=body)


# ---------- §3.8 authentication ----------


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("GET", "/api/epics?team_id=1", None),
        ("POST", "/api/epics", {"team_id": 1, "title": "X"}),
        ("PATCH", "/api/epics/1", {"title": "X"}),
        ("DELETE", "/api/epics/1", None),
    ],
)
def test_epics_require_session(client, method, path, body):
    assert client.request(method, path, json=body).status_code == 401


# ---------- §5.1 / §5.4 / §5.5 create ----------


def test_create_epic_returns_all_fields(auth_client, team):
    r = create(auth_client, team["id"], "  Checkout reliability ", "  Improve checkout errors.  ")
    assert r.status_code == 201
    epic = r.json()
    assert set(epic) == {"id", "team_id", "title", "description", "ticket_count", "created_at", "modified_at"}
    assert epic["team_id"] == team["id"]
    assert epic["title"] == "Checkout reliability"
    assert epic["description"] == "Improve checkout errors."
    assert epic["ticket_count"] == 0
    assert ISO_Z.match(epic["created_at"]) and epic["created_at"] == epic["modified_at"]


@pytest.mark.parametrize("description", [None, "", "   "])
def test_description_is_optional_and_blank_is_null(auth_client, team, description):
    r = create(auth_client, team["id"], description=description)
    assert r.status_code == 201
    assert r.json()["description"] is None


@pytest.mark.parametrize("title", ["", "   ", "\n\t"])
def test_empty_title_is_422(auth_client, team, title):
    r = create(auth_client, team["id"], title)
    assert r.status_code == 422
    assert r.json()["field"] == "title"
    assert r.json()["message"] == "Epic title is required"


def test_create_for_unknown_team_is_422(auth_client):
    r = create(auth_client, 999)
    assert r.status_code == 422
    assert r.json()["field"] == "team_id"


def test_create_without_team_is_422(auth_client):
    r = auth_client.post("/api/epics", json={"title": "No team"})
    assert r.status_code == 422
    assert r.json()["field"] == "team_id"


def test_duplicate_titles_are_allowed(auth_client, team):
    """project_requirements.md requires no uniqueness for epic titles."""
    assert create(auth_client, team["id"], "Same").status_code == 201
    assert create(auth_client, team["id"], "Same").status_code == 201


# ---------- list ----------


def test_list_epics_of_one_team_newest_modified_first(auth_client, team, other_team):
    a = create(auth_client, team["id"], "A").json()
    create(auth_client, team["id"], "B")
    create(auth_client, other_team["id"], "Other team's epic")
    time.sleep(0.01)
    auth_client.patch(f"/api/epics/{a['id']}", json={"title": "A2"})
    r = auth_client.get(f"/api/epics?team_id={team['id']}")
    assert r.status_code == 200
    assert [e["title"] for e in r.json()] == ["A2", "B"]


def test_list_requires_existing_team(auth_client):
    assert auth_client.get("/api/epics").status_code == 422
    assert auth_client.get("/api/epics?team_id=999").status_code == 422


# ---------- edit; §5.2 team is fixed ----------


def test_edit_title_and_description(auth_client, team):
    epic = create(auth_client, team["id"], "Old", "old text").json()
    time.sleep(0.01)
    r = auth_client.patch(f"/api/epics/{epic['id']}", json={"title": " New ", "description": "new text"})
    assert r.status_code == 200
    out = r.json()
    assert (out["title"], out["description"]) == ("New", "new text")
    assert out["created_at"] == epic["created_at"]
    assert out["modified_at"] > epic["modified_at"]


def test_clear_description(auth_client, team):
    epic = create(auth_client, team["id"], description="something").json()
    r = auth_client.patch(f"/api/epics/{epic['id']}", json={"description": ""})
    assert r.json()["description"] is None


def test_saving_unchanged_values_keeps_modified_at(auth_client, team):
    epic = create(auth_client, team["id"], "Same", "text").json()
    time.sleep(0.01)
    r = auth_client.patch(f"/api/epics/{epic['id']}", json={"title": " Same ", "description": "text"})
    assert r.status_code == 200
    assert r.json()["modified_at"] == epic["modified_at"]


@pytest.mark.parametrize("body", [{"title": ""}, {"title": "   "}, {"title": None}])
def test_edit_to_empty_title_is_422(auth_client, team, body):
    epic = create(auth_client, team["id"]).json()
    r = auth_client.patch(f"/api/epics/{epic['id']}", json=body)
    assert r.status_code == 422
    assert r.json()["field"] == "title"


@pytest.mark.parametrize("new_team", ["other", "same"])
def test_team_cannot_be_changed(auth_client, team, other_team, new_team):
    epic = create(auth_client, team["id"]).json()
    target = other_team["id"] if new_team == "other" else team["id"]
    r = auth_client.patch(f"/api/epics/{epic['id']}", json={"team_id": target, "title": "Changed"})
    assert r.status_code == 422
    assert r.json()["code"] == "epic_team_immutable"
    assert r.json()["message"] == "The team of an epic cannot be changed."
    listed = auth_client.get(f"/api/epics?team_id={team['id']}").json()
    assert [(e["id"], e["title"]) for e in listed] == [(epic["id"], "Checkout reliability")]


def test_unknown_field_is_422(auth_client, team):
    epic = create(auth_client, team["id"]).json()
    assert auth_client.patch(f"/api/epics/{epic['id']}", json={"colour": "red"}).status_code == 422


def test_edit_missing_epic_is_404(auth_client):
    assert auth_client.patch("/api/epics/999", json={"title": "X"}).status_code == 404


# ---------- delete ----------


def test_delete_epic(auth_client, team):
    epic = create(auth_client, team["id"]).json()
    assert auth_client.delete(f"/api/epics/{epic['id']}").status_code == 204
    assert auth_client.get(f"/api/epics?team_id={team['id']}").json() == []


def test_delete_missing_epic_is_404(auth_client):
    assert auth_client.delete("/api/epics/999").status_code == 404


# ---------- §4.5 team with epics cannot be deleted; epic_count on teams ----------


def test_team_lists_epic_count(auth_client, team):
    create(auth_client, team["id"], "A")
    create(auth_client, team["id"], "B")
    assert auth_client.get("/api/teams").json()[0]["epic_count"] == 2


def test_team_with_epics_cannot_be_deleted(auth_client, team):
    epic = create(auth_client, team["id"]).json()
    r = auth_client.delete(f"/api/teams/{team['id']}")
    assert r.status_code == 409
    assert r.json()["code"] == "team_not_empty"
    assert r.json()["message"] == "Team has 0 tickets and 1 epic. Delete or move them first."
    assert len(auth_client.get(f"/api/epics?team_id={team['id']}").json()) == 1  # no cascade
    # after the epic is gone the team can be deleted
    auth_client.delete(f"/api/epics/{epic['id']}")
    assert auth_client.delete(f"/api/teams/{team['id']}").status_code == 204


def test_db_blocks_team_delete_with_epics_and_untrimmed_titles(auth_client, team):
    """The DB enforces §4.5 and §5.5 too, not only the API."""
    create(auth_client, team["id"])
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("DELETE FROM teams WHERE id = :id"), {"id": team["id"]})
    for bad in ["", " padded "]:
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text("INSERT INTO epics (team_id, title) VALUES (:t, :x)"), {"t": team["id"], "x": bad})

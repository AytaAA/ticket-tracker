"""§6 Tickets — business rules (PLAN.md §4 slice 4), plus the ticket parts of §4.5, §5.6–§5.8."""

import re
import time

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine

ISO_Z = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
STATES = ["new", "ready_for_implementation", "in_progress", "ready_for_acceptance", "done"]


@pytest.fixture
def team(auth_client):
    return auth_client.post("/api/teams", json={"name": "Payments"}).json()


@pytest.fixture
def other_team(auth_client):
    return auth_client.post("/api/teams", json={"name": "Mobile"}).json()


@pytest.fixture
def epic(auth_client, team):
    return auth_client.post("/api/epics", json={"team_id": team["id"], "title": "Checkout"}).json()


@pytest.fixture
def other_epic(auth_client, other_team):
    return auth_client.post("/api/epics", json={"team_id": other_team["id"], "title": "Mobile epic"}).json()


def new_ticket(client, team_id, **fields):
    body = {"team_id": team_id, "type": "bug", "title": "Payment fails", "body": "Steps to reproduce", **fields}
    return client.post("/api/tickets", json=body)


def patch(client, ticket_id, **fields):
    return client.patch(f"/api/tickets/{ticket_id}", json=fields)


# ---------- §3.8 ----------


@pytest.mark.parametrize(
    "method, path",
    [("GET", "/api/tickets?team_id=1"), ("POST", "/api/tickets"), ("GET", "/api/tickets/1"),
     ("PATCH", "/api/tickets/1"), ("DELETE", "/api/tickets/1")],
)
def test_tickets_require_session(client, method, path):
    assert client.request(method, path, json={}).status_code == 401


# ---------- §6.1 / §6.2 / §6.3 create + view ----------


def test_create_ticket_has_all_fields(auth_client, team, epic):
    r = new_ticket(auth_client, team["id"], epic_id=epic["id"], title="  Payment fails  ", state="in_progress")
    assert r.status_code == 201
    t = r.json()
    assert set(t) == {"id", "team_id", "epic_id", "epic_title", "type", "state", "title", "body",
                      "created_by", "created_at", "modified_at"}
    assert t["title"] == "Payment fails"
    assert (t["team_id"], t["epic_id"], t["epic_title"]) == (team["id"], epic["id"], "Checkout")
    assert (t["type"], t["state"]) == ("bug", "in_progress")
    assert t["created_by"]["email"] == "member@example.com"  # set from the session, §6.1
    assert ISO_Z.match(t["created_at"]) and t["created_at"] == t["modified_at"]
    assert auth_client.get(f"/api/tickets/{t['id']}").json() == t


def test_state_defaults_to_new_and_epic_is_optional(auth_client, team):
    t = new_ticket(auth_client, team["id"]).json()
    assert (t["state"], t["epic_id"], t["epic_title"]) == ("new", None, None)


def test_created_by_cannot_be_set_by_client(auth_client, team):
    assert new_ticket(auth_client, team["id"], created_by=999).status_code == 422


@pytest.mark.parametrize("ticket_type", ["bug", "feature", "fix"])
def test_all_types_accepted(auth_client, team, ticket_type):
    assert new_ticket(auth_client, team["id"], type=ticket_type).status_code == 201


@pytest.mark.parametrize("state", STATES)
def test_all_states_accepted(auth_client, team, state):
    assert new_ticket(auth_client, team["id"], state=state).status_code == 201


@pytest.mark.parametrize(
    "field, value",
    [("type", "Bug"), ("type", "task"), ("type", ""), ("state", "In progress"), ("state", "in progress"),
     ("state", "closed"), ("title", ""), ("title", "   "), ("body", ""), ("body", "  \n ")],
)
def test_invalid_values_are_422(auth_client, team, field, value):
    """§6.9: the backend validates enums and required text itself."""
    r = new_ticket(auth_client, team["id"], **{field: value})
    assert r.status_code == 422
    assert r.json()["field"] == field


@pytest.mark.parametrize("missing", ["team_id", "type", "title", "body"])
def test_required_fields(auth_client, team, missing):
    body = {"team_id": team["id"], "type": "bug", "title": "T", "body": "B"}
    del body[missing]
    r = auth_client.post("/api/tickets", json=body)
    assert r.status_code == 422
    assert r.json()["field"] == missing


def test_unknown_team_is_422(auth_client):
    r = new_ticket(auth_client, 999)
    assert r.status_code == 422 and r.json()["field"] == "team_id"


def test_unknown_epic_is_422(auth_client, team):
    r = new_ticket(auth_client, team["id"], epic_id=999)
    assert r.status_code == 422 and r.json()["field"] == "epic_id"


def test_epic_from_other_team_is_422(auth_client, team, other_epic):
    """§5.7: backend enforces same-team epic."""
    r = new_ticket(auth_client, team["id"], epic_id=other_epic["id"])
    assert r.status_code == 422
    assert r.json()["code"] == "epic_team_mismatch"


def test_db_rejects_epic_from_other_team_and_bad_enums(auth_client, team, other_epic):
    """§5.7 / §6.1 enforced by the database too (composite FK + CHECK)."""
    uid = auth_client.get("/api/auth/me").json()["id"]
    insert = text("INSERT INTO tickets (team_id, epic_id, type, state, title, body, created_by) "
                  "VALUES (:team, :epic, :type, :state, 'T', 'B', :uid)")
    bad_rows = [
        {"team": team["id"], "epic": other_epic["id"], "type": "bug", "state": "new"},
        {"team": team["id"], "epic": None, "type": "Bug", "state": "new"},
        {"team": team["id"], "epic": None, "type": "bug", "state": "closed"},
    ]
    for row in bad_rows:
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(insert, {**row, "uid": uid})


def test_get_missing_ticket_is_404(auth_client):
    assert auth_client.get("/api/tickets/999").status_code == 404


# ---------- list (board data) ----------


def test_list_is_team_only_newest_modified_first(auth_client, team, other_team, epic):
    a = new_ticket(auth_client, team["id"], title="A", epic_id=epic["id"]).json()
    new_ticket(auth_client, team["id"], title="B")
    new_ticket(auth_client, other_team["id"], title="Other team")
    time.sleep(0.01)
    patch(auth_client, a["id"], state="done")
    r = auth_client.get(f"/api/tickets?team_id={team['id']}")
    assert r.status_code == 200
    rows = r.json()
    assert [t["title"] for t in rows] == ["A", "B"]
    assert rows[0]["epic_title"] == "Checkout" and rows[0]["state"] == "done"
    assert "body" not in rows[0]


def test_list_requires_existing_team(auth_client):
    assert auth_client.get("/api/tickets").status_code == 422
    assert auth_client.get("/api/tickets?team_id=999").status_code == 422


# ---------- §6.4 / §6.5 edit ----------


def test_edit_every_field(auth_client, team, other_team, other_epic):
    t = new_ticket(auth_client, team["id"]).json()
    time.sleep(0.01)
    r = patch(auth_client, t["id"], team_id=other_team["id"], epic_id=other_epic["id"], type="feature",
              state="ready_for_acceptance", title=" New title ", body="New body")
    assert r.status_code == 200
    out = r.json()
    assert (out["team_id"], out["epic_id"], out["type"], out["state"], out["title"], out["body"]) == (
        other_team["id"], other_epic["id"], "feature", "ready_for_acceptance", "New title", "New body")
    assert out["created_at"] == t["created_at"] and out["created_by"] == t["created_by"]
    assert out["modified_at"] > t["modified_at"]


def test_saving_unchanged_values_keeps_modified_at(auth_client, team, epic):
    t = new_ticket(auth_client, team["id"], epic_id=epic["id"]).json()
    time.sleep(0.01)
    r = patch(auth_client, t["id"], team_id=team["id"], epic_id=epic["id"], type="bug", state="new",
              title="  Payment fails ", body="Steps to reproduce")
    assert r.status_code == 200
    assert r.json()["modified_at"] == t["modified_at"]
    assert patch(auth_client, t["id"]).json()["modified_at"] == t["modified_at"]  # empty patch


def test_state_change_alone_moves_modified_at(auth_client, team):
    """§6.8 drag-and-drop sends only the state; any state to any state is allowed (§8.6)."""
    t = new_ticket(auth_client, team["id"]).json()
    time.sleep(0.01)
    r = patch(auth_client, t["id"], state="done")
    assert r.status_code == 200
    assert r.json()["state"] == "done" and r.json()["modified_at"] > t["modified_at"]
    assert auth_client.get(f"/api/tickets/{t['id']}").json()["state"] == "done"
    assert patch(auth_client, t["id"], state="new").json()["state"] == "new"


def test_remove_epic(auth_client, team, epic):
    t = new_ticket(auth_client, team["id"], epic_id=epic["id"]).json()
    out = patch(auth_client, t["id"], epic_id=None).json()
    assert (out["epic_id"], out["epic_title"]) == (None, None)


def test_team_change_keeping_old_epic_is_rejected(auth_client, team, other_team, epic):
    """§6.6: the backend rejects a ticket whose epic belongs to a different team."""
    t = new_ticket(auth_client, team["id"], epic_id=epic["id"]).json()
    r = patch(auth_client, t["id"], team_id=other_team["id"])
    assert r.status_code == 422
    assert r.json()["code"] == "epic_team_mismatch"
    assert auth_client.get(f"/api/tickets/{t['id']}").json()["team_id"] == team["id"]
    # with the epic cleared it works
    out = patch(auth_client, t["id"], team_id=other_team["id"], epic_id=None).json()
    assert (out["team_id"], out["epic_id"]) == (other_team["id"], None)


def test_setting_epic_of_other_team_is_rejected(auth_client, team, other_epic):
    t = new_ticket(auth_client, team["id"]).json()
    assert patch(auth_client, t["id"], epic_id=other_epic["id"]).status_code == 422


@pytest.mark.parametrize(
    "fields",
    [{"type": "task"}, {"state": "closed"}, {"title": " "}, {"body": ""}, {"title": None}, {"state": None},
     {"team_id": None}, {"team_id": 999}, {"created_by": 1}, {"created_at": "2020-01-01T00:00:00Z"}],
)
def test_invalid_edits_are_422(auth_client, team, fields):
    t = new_ticket(auth_client, team["id"]).json()
    assert patch(auth_client, t["id"], **fields).status_code == 422
    assert auth_client.get(f"/api/tickets/{t['id']}").json()["modified_at"] == t["modified_at"]


def test_edit_missing_ticket_is_404(auth_client):
    assert patch(auth_client, 999, state="done").status_code == 404


# ---------- §6.7 delete ----------


def test_delete_ticket(auth_client, team):
    t = new_ticket(auth_client, team["id"]).json()
    assert auth_client.delete(f"/api/tickets/{t['id']}").status_code == 204
    assert auth_client.get(f"/api/tickets/{t['id']}").status_code == 404
    assert auth_client.delete(f"/api/tickets/{t['id']}").status_code == 404


# ---------- §4.5 / §5.8 counts and delete guards ----------


def test_counts_on_teams_and_epics(auth_client, team, epic):
    new_ticket(auth_client, team["id"], epic_id=epic["id"])
    new_ticket(auth_client, team["id"])
    assert auth_client.get("/api/teams").json()[0]["ticket_count"] == 2
    assert auth_client.get(f"/api/epics?team_id={team['id']}").json()[0]["ticket_count"] == 1


def test_team_with_tickets_cannot_be_deleted(auth_client, team):
    t = new_ticket(auth_client, team["id"]).json()
    r = auth_client.delete(f"/api/teams/{team['id']}")
    assert r.status_code == 409
    assert r.json()["message"] == "Team has 1 ticket and 0 epics. Delete or move them first."
    auth_client.delete(f"/api/tickets/{t['id']}")
    assert auth_client.delete(f"/api/teams/{team['id']}").status_code == 204


def test_epic_referenced_by_tickets_cannot_be_deleted(auth_client, team, epic):
    t1 = new_ticket(auth_client, team["id"], epic_id=epic["id"]).json()
    new_ticket(auth_client, team["id"], epic_id=epic["id"])
    r = auth_client.delete(f"/api/epics/{epic['id']}")
    assert r.status_code == 409
    assert r.json()["code"] == "epic_in_use"
    assert r.json()["message"] == "2 tickets reference this epic. Remove the epic from those tickets or delete them first."
    assert auth_client.get(f"/api/tickets/{t1['id']}").json()["epic_id"] == epic["id"]  # no cascade


def test_db_blocks_deleting_referenced_epic(auth_client, team, epic):
    new_ticket(auth_client, team["id"], epic_id=epic["id"])
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("DELETE FROM epics WHERE id = :id"), {"id": epic["id"]})

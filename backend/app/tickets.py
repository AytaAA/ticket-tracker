"""§6 Tickets. Endpoints and status codes: PLAN.md §2. All endpoints need a session (§3.8)."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.errors import ApiError
from app.models import TICKET_STATES, TICKET_TYPES, Epic, Team, Ticket, User
from app.security import iso, utcnow

router = APIRouter(prefix="/api/tickets", tags=["tickets"], dependencies=[Depends(current_user)])


# ---------- validation (§6.1, §6.9: the backend validates everything itself) ----------


def _check_type(v: str) -> str:
    if v not in TICKET_TYPES:
        raise ValueError(f"Type must be one of: {', '.join(TICKET_TYPES)}")
    return v


def _check_state(v: str) -> str:
    if v not in TICKET_STATES:
        raise ValueError(f"State must be one of: {', '.join(TICKET_STATES)}")
    return v


def _check_title(v: str) -> str:
    title = v.strip()
    if not title:
        raise ValueError("Title is required")
    return title


def _check_body(v: str) -> str:
    if not v.strip():
        raise ValueError("Body is required")
    return v


class TicketCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    team_id: int
    type: str
    state: str = "new"
    title: str
    body: str
    epic_id: int | None = None

    @field_validator("type")
    @classmethod
    def v_type(cls, v):
        return _check_type(v)

    @field_validator("state")
    @classmethod
    def v_state(cls, v):
        return _check_state(v)

    @field_validator("title")
    @classmethod
    def v_title(cls, v):
        return _check_title(v)

    @field_validator("body")
    @classmethod
    def v_body(cls, v):
        return _check_body(v)


class TicketUpdate(BaseModel):
    """Every field optional; only the fields sent are considered. Only epic_id may be null."""

    model_config = ConfigDict(extra="forbid")
    team_id: int | None = None
    type: str | None = None
    state: str | None = None
    title: str | None = None
    body: str | None = None
    epic_id: int | None = None

    @field_validator("type")
    @classmethod
    def v_type(cls, v):
        return None if v is None else _check_type(v)

    @field_validator("state")
    @classmethod
    def v_state(cls, v):
        return None if v is None else _check_state(v)

    @field_validator("title")
    @classmethod
    def v_title(cls, v):
        return None if v is None else _check_title(v)

    @field_validator("body")
    @classmethod
    def v_body(cls, v):
        return None if v is None else _check_body(v)


# ---------- helpers ----------


def _require_team(db: DbSession, team_id: int) -> None:
    if db.get(Team, team_id) is None:
        raise ApiError(422, "validation_error", "Team not found", "team_id")


def _check_epic(db: DbSession, epic_id: int | None, team_id: int) -> None:
    """§5.7 / §6.6: the epic must exist and belong to the ticket's team."""
    if epic_id is None:
        return
    epic = db.get(Epic, epic_id)
    if epic is None:
        raise ApiError(422, "validation_error", "Epic not found", "epic_id")
    if epic.team_id != team_id:
        raise ApiError(422, "epic_team_mismatch", "The epic belongs to a different team than the ticket.", "epic_id")


def _get_ticket(db: DbSession, ticket_id: int) -> Ticket:
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise ApiError(404, "not_found", "Ticket not found.")
    return ticket


def _commit(db: DbSession) -> None:
    # The DB constraints are the final word if a team/epic changed between the checks and the write
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ApiError(422, "validation_error", "Team or epic is no longer valid. Reload and try again.")


def ticket_summary(ticket: Ticket, epic_title: str | None) -> dict:
    """Board card data (no body, to keep the board payload small with 100+ tickets, §8.10)."""
    return {
        "id": ticket.id,
        "team_id": ticket.team_id,
        "epic_id": ticket.epic_id,
        "epic_title": epic_title,
        "type": ticket.type,
        "state": ticket.state,
        "title": ticket.title,
        "created_at": iso(ticket.created_at),
        "modified_at": iso(ticket.modified_at),
    }


def ticket_detail(db: DbSession, ticket: Ticket) -> dict:
    """§6.3: all fields, including created by / created at / modified at."""
    epic = db.get(Epic, ticket.epic_id) if ticket.epic_id else None
    author = db.get(User, ticket.created_by)
    return {
        **ticket_summary(ticket, epic.title if epic else None),
        "body": ticket.body,
        "created_by": {"id": author.id, "email": author.email},
    }


# ---------- endpoints ----------


@router.get("")
def list_tickets(team_id: int = Query(...), db: DbSession = Depends(get_db)):
    """All tickets of one team, most recently modified first (§8.7). Filtering is client-side (PLAN.md D5)."""
    _require_team(db, team_id)
    rows = db.execute(
        select(Ticket, Epic.title)
        .outerjoin(Epic, Epic.id == Ticket.epic_id)
        .where(Ticket.team_id == team_id)
        .order_by(Ticket.modified_at.desc(), Ticket.id.desc())
    ).all()
    return [ticket_summary(t, epic_title) for t, epic_title in rows]


@router.post("", status_code=201)
def create_ticket(body: TicketCreate, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    _require_team(db, body.team_id)
    _check_epic(db, body.epic_id, body.team_id)
    now = utcnow()
    ticket = Ticket(**body.model_dump(), created_by=user.id, created_at=now, modified_at=now)
    db.add(ticket)
    _commit(db)
    return ticket_detail(db, ticket)


@router.get("/{ticket_id}")
def get_ticket(ticket_id: int, db: DbSession = Depends(get_db)):
    return ticket_detail(db, _get_ticket(db, ticket_id))


@router.patch("/{ticket_id}")
def update_ticket(ticket_id: int, body: TicketUpdate, db: DbSession = Depends(get_db)):
    """§6.4 edit; §6.8 drag-and-drop sends only {"state": ...}. §9.7 last write wins."""
    ticket = _get_ticket(db, ticket_id)
    sent = body.model_dump(include=body.model_fields_set)
    for field in ("team_id", "type", "state", "title", "body"):
        if field in sent and sent[field] is None:
            label = {"team_id": "Team", "type": "Type", "state": "State", "title": "Title", "body": "Body"}[field]
            raise ApiError(422, "validation_error", f"{label} is required", field)

    new_team = sent.get("team_id", ticket.team_id)
    new_epic = sent.get("epic_id", ticket.epic_id)
    if new_team != ticket.team_id:
        _require_team(db, new_team)
    if "team_id" in sent or "epic_id" in sent:
        _check_epic(db, new_epic, new_team)  # §6.6: an epic from the old team is rejected

    changed = False
    for field, value in sent.items():
        if getattr(ticket, field) != value:
            setattr(ticket, field, value)
            changed = True
    if changed:  # §6.5: saving unchanged values must not move modified_at
        ticket.modified_at = utcnow()
        _commit(db)
    return ticket_detail(db, ticket)


@router.delete("/{ticket_id}", status_code=204)
def delete_ticket(ticket_id: int, db: DbSession = Depends(get_db)):
    """§6.7: comments are removed with the ticket (FK ON DELETE CASCADE). The UI asks for confirmation first."""
    db.delete(_get_ticket(db, ticket_id))
    db.commit()

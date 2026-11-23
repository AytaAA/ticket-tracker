"""§5 Epics. Endpoints and status codes: PLAN.md §2. All endpoints need a session (§3.8)."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.errors import ApiError
from app.models import Epic, Team
from app.security import iso, utcnow

router = APIRouter(prefix="/api/epics", tags=["epics"], dependencies=[Depends(current_user)])

MAX_TITLE_LENGTH = 200
MAX_DESCRIPTION_LENGTH = 10_000


def _clean_title(v: str | None) -> str:
    """§5.5: non-empty after trimming."""
    title = (v or "").strip()
    if not title:
        raise ValueError("Epic title is required")
    if len(title) > MAX_TITLE_LENGTH:
        raise ValueError(f"Epic title must be at most {MAX_TITLE_LENGTH} characters")
    return title


def _clean_description(v: str | None) -> str | None:
    """§5.4: optional. Blank is stored as NULL."""
    desc = (v or "").strip()
    if len(desc) > MAX_DESCRIPTION_LENGTH:
        raise ValueError(f"Description must be at most {MAX_DESCRIPTION_LENGTH} characters")
    return desc or None


class EpicCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    team_id: int
    title: str
    description: str | None = None

    @field_validator("title")
    @classmethod
    def check_title(cls, v):
        return None if v is None else _clean_title(v)

    @field_validator("description")
    @classmethod
    def check_description(cls, v):
        return _clean_description(v)


class EpicUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    description: str | None = None
    # Accepted only so it can be refused with a clear message (§5.2)
    team_id: int | None = None

    @field_validator("title")
    @classmethod
    def check_title(cls, v):
        return None if v is None else _clean_title(v)

    @field_validator("description")
    @classmethod
    def check_description(cls, v):
        return _clean_description(v)


def epic_usage(db: DbSession, epic_id: int) -> int:
    """Number of tickets referencing the epic; drives the §5.8 delete guard.
    Tickets don't exist until slice 4, which adds the count here."""
    return 0


def epic_out(db: DbSession, epic: Epic) -> dict:
    return {
        "id": epic.id,
        "team_id": epic.team_id,
        "title": epic.title,
        "description": epic.description,
        "ticket_count": epic_usage(db, epic.id),
        "created_at": iso(epic.created_at),
        "modified_at": iso(epic.modified_at),
    }


def _require_team(db: DbSession, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise ApiError(422, "validation_error", "Team not found", "team_id")
    return team


def _get_epic(db: DbSession, epic_id: int) -> Epic:
    epic = db.get(Epic, epic_id)
    if epic is None:
        raise ApiError(404, "not_found", "Epic not found.")
    return epic


@router.get("")
def list_epics(team_id: int = Query(...), db: DbSession = Depends(get_db)):
    """Epics of one team, most recently modified first."""
    _require_team(db, team_id)
    epics = db.scalars(
        select(Epic).where(Epic.team_id == team_id).order_by(Epic.modified_at.desc(), Epic.id.desc())
    ).all()
    return [epic_out(db, e) for e in epics]


@router.post("", status_code=201)
def create_epic(body: EpicCreate, db: DbSession = Depends(get_db)):
    _require_team(db, body.team_id)
    now = utcnow()
    epic = Epic(team_id=body.team_id, title=body.title, description=body.description, created_at=now, modified_at=now)
    db.add(epic)
    try:
        db.commit()
    except IntegrityError:  # team deleted in the meantime
        db.rollback()
        raise ApiError(422, "validation_error", "Team not found", "team_id")
    return epic_out(db, epic)


@router.patch("/{epic_id}")
def update_epic(epic_id: int, body: EpicUpdate, db: DbSession = Depends(get_db)):
    epic = _get_epic(db, epic_id)
    if "team_id" in body.model_fields_set:
        raise ApiError(422, "epic_team_immutable", "The team of an epic cannot be changed.", "team_id")
    changes = {}
    if "title" in body.model_fields_set:
        if body.title is None:
            raise ApiError(422, "validation_error", "Epic title is required", "title")
        changes["title"] = body.title
    if "description" in body.model_fields_set:
        changes["description"] = body.description
    changed = False
    for field, value in changes.items():
        if getattr(epic, field) != value:
            setattr(epic, field, value)
            changed = True
    if changed:  # saving unchanged values must not move modified_at
        epic.modified_at = utcnow()
        db.commit()
    return epic_out(db, epic)


@router.delete("/{epic_id}", status_code=204)
def delete_epic(epic_id: int, db: DbSession = Depends(get_db)):
    epic = _get_epic(db, epic_id)
    _ensure_unreferenced(epic_usage(db, epic.id))
    db.delete(epic)
    try:
        db.commit()
    except IntegrityError:  # a ticket started referencing it in the meantime (FK restrict)
        db.rollback()
        _ensure_unreferenced(epic_usage(db, epic.id) or 1)


def _ensure_unreferenced(tickets: int) -> None:
    """§5.8: no deleting an epic that tickets reference; no cascade."""
    if tickets:
        noun = "ticket references" if tickets == 1 else "tickets reference"
        raise ApiError(
            409,
            "epic_in_use",
            f"{tickets} {noun} this epic. Remove the epic from those tickets or delete them first.",
        )

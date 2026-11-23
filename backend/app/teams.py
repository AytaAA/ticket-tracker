"""§4 Teams. Endpoints and status codes: PLAN.md §2. All endpoints need a session (§3.8, §4.6)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.errors import ApiError
from app.models import Epic, Team, Ticket
from app.security import iso, utcnow

router = APIRouter(prefix="/api/teams", tags=["teams"], dependencies=[Depends(current_user)])

MAX_NAME_LENGTH = 100


class TeamBody(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        """§4.4: non-empty after trimming."""
        name = (v or "").strip()
        if not name:
            raise ValueError("Team name is required")
        if len(name) > MAX_NAME_LENGTH:
            raise ValueError(f"Team name must be at most {MAX_NAME_LENGTH} characters")
        return name


def team_usage(db: DbSession, team_id: int) -> tuple[int, int]:
    """(ticket_count, epic_count) for a team; also drives the §4.5 delete guard."""
    tickets = db.scalar(select(func.count()).select_from(Ticket).where(Ticket.team_id == team_id))
    epics = db.scalar(select(func.count()).select_from(Epic).where(Epic.team_id == team_id))
    return tickets, epics


def team_out(db: DbSession, team: Team) -> dict:
    tickets, epics = team_usage(db, team.id)
    return {
        "id": team.id,
        "name": team.name,
        "ticket_count": tickets,
        "epic_count": epics,
        "created_at": iso(team.created_at),
        "modified_at": iso(team.modified_at),
    }


def _get_team(db: DbSession, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise ApiError(404, "not_found", "Team not found.")
    return team


def _ensure_name_free(db: DbSession, name: str, except_id: int | None = None) -> None:
    """§4.4: unique case-insensitively."""
    q = select(Team.id).where(func.lower(Team.name) == name.lower())
    if except_id is not None:
        q = q.where(Team.id != except_id)
    if db.scalar(q) is not None:
        raise _duplicate(name)


def _duplicate(name: str) -> ApiError:
    return ApiError(409, "team_name_taken", f'A team named "{name}" already exists.', "name")


def _commit(db: DbSession, name: str) -> None:
    # The unique index is the final word if two requests race past _ensure_name_free
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _duplicate(name)


@router.get("")
def list_teams(db: DbSession = Depends(get_db)):
    teams = db.scalars(select(Team).order_by(func.lower(Team.name), Team.id)).all()
    return [team_out(db, t) for t in teams]


@router.post("", status_code=201)
def create_team(body: TeamBody, db: DbSession = Depends(get_db)):
    _ensure_name_free(db, body.name)
    now = utcnow()
    team = Team(name=body.name, created_at=now, modified_at=now)
    db.add(team)
    _commit(db, body.name)
    return team_out(db, team)


@router.patch("/{team_id}")
def rename_team(team_id: int, body: TeamBody, db: DbSession = Depends(get_db)):
    team = _get_team(db, team_id)
    if body.name != team.name:  # saving the same name must not move modified_at
        _ensure_name_free(db, body.name, except_id=team.id)
        team.name = body.name
        team.modified_at = utcnow()
        _commit(db, body.name)
    return team_out(db, team)


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: int, db: DbSession = Depends(get_db)):
    team = _get_team(db, team_id)
    tickets, epics = team_usage(db, team.id)
    if tickets or epics:  # §4.5: no cascade
        raise ApiError(
            409,
            "team_not_empty",
            f"Team has {_plural(tickets, 'ticket')} and {_plural(epics, 'epic')}. "
            "Delete or move them first.",
        )
    db.delete(team)
    try:
        db.commit()
    except IntegrityError:  # an epic/ticket was added in the meantime (FK restrict, no cascade)
        db.rollback()
        raise ApiError(409, "team_not_empty", "Team is not empty any more. Reload and try again.")


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"

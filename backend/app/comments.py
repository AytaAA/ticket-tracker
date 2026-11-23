"""§7 Comments. Endpoints and status codes: PLAN.md §2. Comments are immutable: no edit/delete endpoints (§7.6)."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.auth import current_user
from app.db import get_db
from app.errors import ApiError
from app.models import Comment, Ticket, User
from app.security import iso, utcnow

router = APIRouter(prefix="/api/tickets/{ticket_id}/comments", tags=["comments"], dependencies=[Depends(current_user)])


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str

    @field_validator("body")
    @classmethod
    def v_body(cls, v: str) -> str:
        """§7.3: non-empty (whitespace-only counts as empty)."""
        if not v.strip():
            raise ValueError("Comment cannot be empty")
        return v.strip()


def comment_out(comment: Comment, author_email: str) -> dict:
    """§7.2: id, ticket, author, body, created timestamp."""
    return {
        "id": comment.id,
        "ticket_id": comment.ticket_id,
        "author": {"id": comment.author_id, "email": author_email},
        "body": comment.body,
        "created_at": iso(comment.created_at),
    }


def _require_ticket(db: DbSession, ticket_id: int) -> None:
    if db.get(Ticket, ticket_id) is None:
        raise ApiError(404, "not_found", "Ticket not found.")


@router.get("")
def list_comments(ticket_id: int, db: DbSession = Depends(get_db)):
    """§7.4 oldest first."""
    _require_ticket(db, ticket_id)
    rows = db.execute(
        select(Comment, User.email)
        .join(User, User.id == Comment.author_id)
        .where(Comment.ticket_id == ticket_id)
        .order_by(Comment.created_at, Comment.id)
    ).all()
    return [comment_out(c, email) for c, email in rows]


@router.post("", status_code=201)
def add_comment(
    ticket_id: int, body: CommentCreate, user: User = Depends(current_user), db: DbSession = Depends(get_db)
):
    """§7.1. §7.5: the ticket's modified_at is NOT touched."""
    _require_ticket(db, ticket_id)
    comment = Comment(ticket_id=ticket_id, author_id=user.id, body=body.body, created_at=utcnow())
    db.add(comment)
    try:
        db.commit()
    except IntegrityError:  # ticket deleted in the meantime
        db.rollback()
        raise ApiError(404, "not_found", "Ticket not found.")
    return comment_out(comment, user.email)

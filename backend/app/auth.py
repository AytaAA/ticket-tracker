"""§3 User accounts and authentication. Endpoints and status codes: PLAN.md §2."""

import re
from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from app.config import settings
from app.db import get_db
from app.errors import ApiError
from app.mailer import send_verification_email
from app.models import EmailVerificationToken, Session, User
from app.security import hash_password, new_token, sha256, utcnow, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_COOKIE = "session"
MIN_PASSWORD_LENGTH = 8  # §3.3
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str) -> str:
    """§3.1: trimmed and compared case-insensitively (stored lowercased)."""
    email = (value or "").strip().lower()
    if not email:
        raise ValueError("Email is required")
    if len(email) > 254 or not _EMAIL_RE.match(email):
        raise ValueError("Enter a valid email address")
    return email


# ---------- request bodies ----------


class EmailBody(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return normalize_email(v)


class SignupBody(EmailBody):
    password: str

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        return v


class LoginBody(BaseModel):
    email: str
    password: str


class VerifyBody(BaseModel):
    token: str


def user_out(user: User) -> dict:
    return {"id": user.id, "email": user.email}


# ---------- helpers ----------


def issue_verification_token(db: DbSession, user: User) -> str:
    """§3.7: a new token invalidates earlier unused tokens."""
    db.execute(
        delete(EmailVerificationToken).where(
            EmailVerificationToken.user_id == user.id, EmailVerificationToken.used_at.is_(None)
        )
    )
    token = new_token()
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=sha256(token),
            expires_at=utcnow() + timedelta(hours=settings.verification_token_hours),
        )
    )
    return token


def current_user(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: DbSession = Depends(get_db),
) -> User:
    """Dependency for every non-public endpoint (§3.8). 401 if there is no valid session."""
    if session:
        row = db.execute(
            select(Session, User)
            .join(User, User.id == Session.user_id)
            .where(Session.id_hash == sha256(session), Session.expires_at > utcnow())
        ).first()
        if row and row.User.is_verified:  # §3.5
            return row.User
    raise ApiError(401, "unauthenticated", "Please log in to continue.")


# ---------- public endpoints ----------


@router.post("/signup", status_code=201)
def signup(body: SignupBody, db: DbSession = Depends(get_db)):
    if db.scalar(select(User.id).where(User.email == body.email)):
        raise ApiError(409, "email_taken", "An account with this email already exists.", "email")
    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    token = issue_verification_token(db, user)
    db.commit()
    sent = send_verification_email(user.email, token)
    return {**user_out(user), "verification_email_sent": sent}


@router.post("/verify")
def verify(body: VerifyBody, db: DbSession = Depends(get_db)):
    row = db.scalar(
        select(EmailVerificationToken).where(EmailVerificationToken.token_hash == sha256(body.token.strip()))
    )
    if row is None:
        raise ApiError(400, "token_invalid", "This verification link is invalid or has been replaced by a newer one.")
    if row.used_at is not None:
        raise ApiError(400, "token_used", "This verification link has already been used.")
    if row.expires_at <= utcnow():
        raise ApiError(400, "token_expired", "This verification link has expired.")
    row.used_at = utcnow()
    db.get(User, row.user_id).is_verified = True
    db.commit()
    return {"message": "Email verified. You can now log in."}


@router.post("/resend-verification", status_code=202)
def resend_verification(body: EmailBody, db: DbSession = Depends(get_db)):
    """Always 202 with the same message, so it does not reveal which emails exist (PLAN.md D8)."""
    user = db.scalar(select(User).where(User.email == body.email))
    if user is not None and not user.is_verified:
        token = issue_verification_token(db, user)
        db.commit()
        send_verification_email(user.email, token)
    return {"message": "If this email is registered and not yet verified, a new verification email has been sent."}


@router.post("/login")
def login(body: LoginBody, response: Response, db: DbSession = Depends(get_db)):
    email = (body.email or "").strip().lower()
    user = db.scalar(select(User).where(User.email == email)) if email else None
    if not verify_password(user.password_hash if user else None, body.password):
        raise ApiError(401, "invalid_credentials", "Incorrect email or password.")
    if not user.is_verified:
        raise ApiError(403, "email_not_verified", "Please verify your email before logging in.")

    sid = new_token()
    db.add(Session(id_hash=sha256(sid), user_id=user.id, expires_at=utcnow() + timedelta(days=settings.session_days)))
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        sid,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return user_out(user)


# ---------- authenticated endpoints ----------


@router.post("/logout", status_code=204)
def logout(
    user: User = Depends(current_user),
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    db: DbSession = Depends(get_db),
):
    db.execute(delete(Session).where(Session.id_hash == sha256(session or "")))
    db.commit()
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=settings.cookie_secure)
    return response


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)

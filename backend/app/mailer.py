"""SMTP sending (§3.4). Host/port/credentials come from SMTP_* env vars, so the
same code works with Mailpit (dev) and relay1.dataart.com."""

import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

log = logging.getLogger("mailer")


def send_email(to: str, subject: str, text: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


def send_verification_email(to: str, token: str) -> bool:
    """Returns False (and logs) instead of raising, so sign-up still succeeds and
    the user can use "Resend email" (§3.7) if the SMTP server is unreachable."""
    link = f"{settings.app_base_url.rstrip('/')}/verify?token={token}"
    text = (
        "Welcome to Ticket Tracker!\n\n"
        "Please confirm your email address by opening this link:\n\n"
        f"{link}\n\n"
        f"The link expires in {settings.verification_token_hours} hours and can be used once.\n"
        "If you did not sign up, ignore this email.\n"
    )
    try:
        send_email(to, "Verify your email for Ticket Tracker", text)
        return True
    except Exception:  # noqa: BLE001 - any SMTP/network failure
        log.exception("Could not send verification email to %s via %s:%s", to, settings.smtp_host, settings.smtp_port)
        return False

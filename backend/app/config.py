from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Read from environment variables (see .env.example)."""

    database_url: str
    app_base_url: str = "http://localhost:8080"
    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = False
    smtp_from: str = "no-reply@ticket-tracker.local"
    smtp_timeout_seconds: int = 10

    # Auth (§3.6, PLAN.md D2)
    verification_token_hours: int = 24
    # Minimum seconds between two verification emails to one address (security review SEC-1, 2026-11-24)
    resend_cooldown_seconds: int = 60
    session_days: int = 7
    # Set to true when the app is served over HTTPS
    cookie_secure: bool = False


settings = Settings()

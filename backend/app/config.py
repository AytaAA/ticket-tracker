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


settings = Settings()

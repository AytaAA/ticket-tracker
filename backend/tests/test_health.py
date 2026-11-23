import os

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text


def test_health_reports_db_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "ok"}


def test_app_db_is_migrated_to_head_on_start():
    """§9.8: the entrypoint applies all Alembic migrations to the app DB before the API starts."""
    head = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
    dev = create_engine(os.environ["DEV_DATABASE_URL"])
    with dev.connect() as conn:
        current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    dev.dispose()
    assert current == head

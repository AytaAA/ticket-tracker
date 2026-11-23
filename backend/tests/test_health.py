from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app

client = TestClient(app)


def test_health_reports_db_ok():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "ok"}


def test_db_is_migrated_to_head_on_start():
    """§9.8: the entrypoint applies all Alembic migrations before the API starts."""
    head = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
    with engine.connect() as conn:
        current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert current == head

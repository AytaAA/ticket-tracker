#!/bin/sh
# Apply migrations on every start (§9.8), then run the API.
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000

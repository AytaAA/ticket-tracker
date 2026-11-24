from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import auth, comments, epics, teams, tickets
from app.db import get_db
from app.errors import install_error_handlers

app = FastAPI(
    title="Ticket Tracker API",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)
install_error_handlers(app)

_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def csrf_guard(request: Request, call_next):
    """Security review 2026-11-24 (CSRF from same-site origins). For state-changing API calls:
    - a browser Origin, when sent, must be this site (nginx forwards Host with the port);
    - a request body must be JSON (a <form> or a fetch() without Content-Type can't be used)."""
    if request.method in _UNSAFE and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.headers.get("host", ""):
            return JSONResponse(status_code=403, content={"code": "cross_origin", "message": "Cross-origin request refused."})
        has_body = request.headers.get("content-length", "0") != "0" or "transfer-encoding" in request.headers
        ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
        if has_body and ctype != "application/json":
            return JSONResponse(
                status_code=415, content={"code": "unsupported_media_type", "message": "Send the request body as JSON."}
            )
    return await call_next(request)
app.include_router(auth.router)
app.include_router(teams.router)
app.include_router(epics.router)
app.include_router(tickets.router)
app.include_router(comments.router)


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    """Public (§3.8). 200 when the DB answers, 503 otherwise (PLAN.md §2)."""
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "db": "unavailable"})
    return {"status": "ok", "db": "ok"}

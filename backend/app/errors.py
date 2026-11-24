"""One error shape for the whole API (PLAN.md §2):
{"code": "...", "message": "..."} and, for 422, also "field"."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, field: str | None = None):
        self.status, self.code, self.message, self.field = status, code, message, field


def _body(code: str, message: str, field: str | None = None) -> dict:
    body = {"code": code, "message": message}
    if field:
        body["field"] = field
    return body


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError):
        return JSONResponse(status_code=exc.status, content=_body(exc.code, exc.message, exc.field))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        loc = [str(p) for p in first.get("loc", ())]
        if loc and loc[0] in ("body", "query", "path"):  # drop only the location prefix ("body" is also a field name)
            loc = loc[1:]
        field = ".".join(loc) or None
        msg = first.get("msg", "Invalid request")
        # pydantic prefixes custom ValueError messages with "Value error, "
        msg = msg.removeprefix("Value error, ")
        return JSONResponse(status_code=422, content=_body("validation_error", msg, field))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        codes = {401: "unauthenticated", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(codes.get(exc.status_code, "error"), str(exc.detail)),
        )

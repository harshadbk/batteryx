"""Error types and FastAPI exception handlers. Every error body is {"error": {code, message, details}}."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, message: str, details=None):
        super().__init__(message)
        self.message = message
        self.details = details


class NotFoundError(AppError):
    status, code = 404, "not_found"


class ConflictError(AppError):
    status, code = 409, "conflict"


class EngineInputError(AppError):
    status, code = 422, "engine_input_error"


def _body(code: str, message: str, details=None) -> dict:
    return {"error": {"code": code, "message": message, "details": details}}


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app(_: Request, e: AppError):
        return JSONResponse(status_code=e.status, content=_body(e.code, e.message, e.details))

    @app.exception_handler(RequestValidationError)
    async def _val(_: Request, e: RequestValidationError):
        details = [{"loc": list(x.get("loc", [])), "msg": x.get("msg"), "type": x.get("type")} for x in e.errors()]
        return JSONResponse(status_code=422, content=_body("validation_error", "Request validation failed", details))

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, e: Exception):
        return JSONResponse(status_code=500, content=_body("internal_error", "Unexpected server error", type(e).__name__))

"""DataRoom AI Backend — FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.models.schemas import ApiResponse
from app.routers import classifications, deals, processing, upload, webhooks
from app.auth import get_current_user_id

import logging
import sys

# Root logger at WARNING so third-party libs (hpack, httpcore, httpx, etc.) stay quiet.
# Our own "dataroom" logger is set to DEBUG so nothing from our code is swallowed.
logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger("dataroom")
logger.setLevel(logging.DEBUG)
# Ensure uvicorn's access/error logs are still visible
logging.getLogger("uvicorn").setLevel(logging.INFO)
logging.getLogger("uvicorn.access").setLevel(logging.INFO)


def _check_db() -> bool:
    """Return True if the database is reachable."""
    try:
        from app.db.client import get_supabase
        sb = get_supabase()
        sb.table("users").select("id").limit(1).execute()
        return True
    except Exception as exc:
        logger.error("Database health check failed: %s", exc)
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — verify DB is reachable
    if not _check_db():
        logger.critical("Cannot connect to database. Shutting down.")
        raise RuntimeError("Database is unreachable — check DATABASE_URL and Supabase status.")
    logger.info("Database connection verified.")
    yield
    # Shutdown


app = FastAPI(
    title="DataRoom AI API",
    version="0.1.0",
    description="Dataroom Intelligence Platform — backend API",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global Exception Handlers ────────────────────────────────────────────────

_STATUS_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    422: "VALIDATION_ERROR",
    429: "TOO_MANY_REQUESTS",
}


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    code = _STATUS_CODES.get(exc.status_code, "ERROR")
    if exc.status_code >= 500:
        logger.error("HTTP %s on %s %s: %s", exc.status_code, request.method, request.url.path, exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content=ApiResponse.fail(code, str(exc.detail)).model_dump(),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    messages = "; ".join(
        f"{'.'.join(str(l) for l in e['loc'])}: {e['msg']}" for e in exc.errors()
    )
    return JSONResponse(
        status_code=422,
        content=ApiResponse.fail("VALIDATION_ERROR", messages).model_dump(),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(
        "UNHANDLED %s on %s %s — %s: %s",
        type(exc).__name__,
        request.method,
        request.url.path,
        type(exc).__name__,
        exc,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=500,
        content=ApiResponse.fail("INTERNAL_ERROR", f"{type(exc).__name__}: {exc}").model_dump(),
    )


# Routers
app.include_router(deals.router, prefix="/api/deals", tags=["deals"])
app.include_router(upload.router, prefix="/api/deals", tags=["upload"])
app.include_router(processing.router, prefix="/api/deals", tags=["processing"])
app.include_router(classifications.router, prefix="/api/classifications", tags=["classifications"])
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["webhooks"])


@app.get("/api/health")
async def health_check():
    db_ok = _check_db()
    if not db_ok:
        return JSONResponse(
            status_code=503,
            content=ApiResponse.fail("DB_UNAVAILABLE", "Database is unreachable.").model_dump(),
        )
    return ApiResponse.ok({"status": "ok", "service": "dataroom-ai-backend", "db": "connected"})


@app.get("/api/me")
async def get_me(clerk_user_id: str = Depends(get_current_user_id)):
    """Return current user info — also ensures user row exists in DB."""
    from app.auth import user_just_created
    from app.db.client import get_supabase
    sb = get_supabase()
    created = user_just_created.get(False)
    rows = sb.table("users").select("*").eq("clerk_user_id", clerk_user_id).execute()
    if not rows.data:
        return ApiResponse.ok({"clerk_user_id": clerk_user_id, "synced": False, "created": False})

    user_data = rows.data[0]
    # Fetch company info if available
    company_data = None
    if user_data.get("company_id"):
        company_rows = sb.table("companies").select("*").eq("id", user_data["company_id"]).execute()
        if company_rows.data:
            company_data = company_rows.data[0]

    return ApiResponse.ok({**user_data, "company": company_data, "synced": True, "created": created})


# ── Socket.IO — wrap FastAPI so both share the same ASGI server ──────────────
import socketio as _socketio
from app.socketio_server import sio

combined_app = _socketio.ASGIApp(sio, other_asgi_app=app)

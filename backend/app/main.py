"""BatteryX AI engineering simulation backend (FastAPI app factory).

Run:  python -m uvicorn app.main:app --reload       (app is built lazily on first access)
  or: python -m uvicorn app.main:create_app --factory --reload
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai.claude_client import ClaudeClient, _key_present as anthropic_key_present
from app.ai.groq_copilot import GroqCopilotClient
from app.ai.llm import LLMClient
from app.api.routes import router
from app.api.routes_copilot import router as copilot_router
from app.api.routes_extra import router as extra_router
from app.config import Settings, load_settings, redact
from app.db.database import make_engine, make_sessionmaker
from app.db.conversations import MongoConversationStore, SqlConversationStore
from app.db.projects import MongoProjectStore, SqlProjectStore
from app.db.repository import MongoCellStore, SqlCellStore, seed
from app.errors import install_handlers
from app.schemas.results import DISCLAIMER

VERSION = "0.4.0"
log = logging.getLogger("batteryx")


def _connect_mongo(settings: Settings):
    from pymongo import MongoClient

    client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=8000, appname="batteryx")
    client.admin.command("ping")
    db = client[settings.mongodb_db]
    return client, (MongoCellStore(db["cells"]), MongoProjectStore(db["projects"]), MongoConversationStore(db["conversations"]))


def _sql_stores(url: str):
    sm = make_sessionmaker(make_engine(url))
    return SqlCellStore(sm), SqlProjectStore(sm), SqlConversationStore(sm)


def _build_store(settings: Settings, database_url: str | None):
    """Returns ((cell_store, project_store, conversation_store), mongo_client | None, status dict). Never exposes credentials."""
    if database_url is not None:  # explicit SQL URL (tests, local overrides)
        return _sql_stores(database_url), None, {"backend": "sql", "url": redact(database_url)}
    fallback = None
    if settings.db_backend in ("auto", "mongo"):
        if settings.mongodb_uri:
            try:
                client, stores = _connect_mongo(settings)
                return stores, client, {"backend": "mongodb", "database": settings.mongodb_db, "status": "connected"}
            except Exception as e:  # noqa: BLE001
                msg = redact(f"{type(e).__name__}: {e}")[:300]
                if settings.db_backend == "mongo":
                    raise RuntimeError(f"MongoDB connection failed ({msg}). Check MONGODB_URI and the Atlas "
                                       "Network Access IP list.") from None
                fallback = f"MongoDB unreachable, using SQL fallback ({msg})"
                log.warning(fallback)
        elif settings.db_backend == "mongo":
            raise RuntimeError("BATTERYX_DB_BACKEND=mongo but MONGODB_URI is not set (see .env.example)")
    stores = _sql_stores(settings.database_url)
    status = {"backend": "sql", "url": redact(settings.database_url)}
    if fallback:
        status["fallback_reason"] = fallback
    return stores, None, status


def _copilot_client(llm: LLMClient):
    """Copilot provider: BATTERYX_COPILOT_PROVIDER = auto (Anthropic if its key is set, else Groq) | anthropic | groq."""
    choice = os.getenv("BATTERYX_COPILOT_PROVIDER", "auto").strip().lower()
    if choice == "groq" or (choice == "auto" and not anthropic_key_present() and llm.configured):
        return GroqCopilotClient(llm)
    return ClaudeClient()


def create_app(database_url: str | None = None, settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    (store, projects, conversations), client, db_status = _build_store(settings, database_url)
    seed(store)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        if client is not None:
            client.close()

    app = FastAPI(
        title="BatteryX AI — Engineering Simulation API",
        version=VERSION,
        lifespan=lifespan,
        description="Battery module design calculations: configuration, energy, ECM simulation, simplified thermal "
                    "and ageing, BMS rule checks, mechanical estimates and design comparison.\n\n" + DISCLAIMER,
    )
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])
    app.state.cells = store
    app.state.projects = projects
    app.state.conversations = conversations
    app.state.llm = LLMClient(settings.groq_api_key, settings.groq_model)
    app.state.claude = _copilot_client(app.state.llm)
    app.state.db_status = db_status
    install_handlers(app)
    app.include_router(router)
    app.include_router(extra_router)
    app.include_router(copilot_router)

    @app.get("/health", tags=["metadata"])
    def health():
        return {"status": "ok", "version": VERSION, "database": app.state.db_status}

    return app


_app: FastAPI | None = None


def __getattr__(name: str):
    """Lazy `app` so importing this module (e.g. in tests) never opens a database connection."""
    global _app
    if name == "app":
        if _app is None:
            _app = create_app()
        return _app
    raise AttributeError(name)

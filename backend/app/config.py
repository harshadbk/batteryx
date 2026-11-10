"""Runtime settings from environment variables, with backend/.env loaded if present.
Secrets (MONGODB_URI) are read from the environment only and are never logged or returned."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")


@dataclass(frozen=True)
class Settings:
    db_backend: str = "auto"  # auto | mongo | sql
    mongodb_uri: str | None = None
    mongodb_db: str = "batteryx"
    database_url: str = "sqlite:///./batteryx.db"
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-120b"
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS


def load_settings() -> Settings:
    try:
        from dotenv import load_dotenv
        load_dotenv(ENV_PATH, override=False)  # real environment variables take precedence
    except ImportError:
        pass
    backend = os.getenv("BATTERYX_DB_BACKEND", "auto").strip().lower()
    if backend not in ("auto", "mongo", "sql"):
        raise RuntimeError(f"BATTERYX_DB_BACKEND must be auto, mongo or sql (got '{backend}')")
    return Settings(
        db_backend=backend,
        mongodb_uri=os.getenv("MONGODB_URI") or None,
        mongodb_db=os.getenv("BATTERYX_MONGODB_DB", "batteryx"),
        database_url=os.getenv("BATTERYX_DATABASE_URL", "sqlite:///./batteryx.db"),
        groq_api_key=os.getenv("GROQ_API_KEY") or None,
        groq_model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
        # Comma-separated extra origins, e.g. your deployed frontend: https://batteryx.vercel.app
        cors_origins=DEFAULT_CORS_ORIGINS + tuple(
            o.strip().rstrip("/") for o in os.getenv("BATTERYX_CORS_ORIGINS", "").split(",") if o.strip()),
    )


def redact(text: str) -> str:
    """Remove credentials from any connection string that might appear in an error message."""
    return re.sub(r"(\w+(?:\+\w+)?://)[^@/\s]+@", r"\1***@", text)

"""Database setup. SQLite by default; set BATTERYX_DATABASE_URL for PostgreSQL, e.g.
postgresql+psycopg://user:pass@localhost:5432/batteryx (requires the psycopg driver)."""
from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


class CellRecord(Base):
    __tablename__ = "cells"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    spec: Mapped[dict] = mapped_column(JSON, nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False, default="user")  # seed | user
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


def make_engine(url: str | None = None):
    url = url or os.getenv("BATTERYX_DATABASE_URL", "sqlite:///./batteryx.db")
    kw: dict = {}
    if url.startswith("sqlite"):
        kw["connect_args"] = {"check_same_thread": False}
        if url in ("sqlite://", "sqlite:///:memory:"):
            kw["poolclass"] = StaticPool  # one shared in-memory DB across threads (tests)
    return create_engine(url, **kw)


def make_sessionmaker(engine):
    from . import conversations, projects  # noqa: F401  register tables before create_all
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)

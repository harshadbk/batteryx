"""Project-scoped copilot conversations (MongoDB or SQL), same interface."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.errors import NotFoundError

from .database import Base

MAX_TURNS = 50


class ConversationRecord(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(32), index=True)
    doc: Mapped[dict] = mapped_column(JSON, nullable=False)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _summary(d: dict) -> dict:
    return {"id": d["id"], "project_id": d["project_id"], "title": d.get("title"), "turn_count": len(d.get("turns", [])),
            "updated_at": d["updated_at"], "created_at": d["created_at"]}


def _new(project_id: str, title: str) -> dict:
    now = _now()
    return {"id": uuid.uuid4().hex[:12], "project_id": project_id, "title": title[:80], "turns": [], "created_at": now, "updated_at": now}


class SqlConversationStore:
    def __init__(self, sessionmaker):
        self.sm = sessionmaker

    def list(self, project_id: str) -> list[dict]:
        with self.sm() as s:
            docs = [r.doc for r in s.query(ConversationRecord).filter_by(project_id=project_id).all()]
        return sorted((_summary(d) for d in docs), key=lambda d: d["updated_at"], reverse=True)

    def get(self, cid: str) -> dict:
        with self.sm() as s:
            r = s.get(ConversationRecord, cid)
            if r is None:
                raise NotFoundError(f"Conversation '{cid}' not found")
            return r.doc

    def create(self, project_id: str, title: str) -> dict:
        d = _new(project_id, title)
        with self.sm() as s:
            s.add(ConversationRecord(id=d["id"], project_id=project_id, doc=d))
            s.commit()
        return d

    def append(self, cid: str, turn: dict) -> dict:
        with self.sm() as s:
            r = s.get(ConversationRecord, cid)
            if r is None:
                raise NotFoundError(f"Conversation '{cid}' not found")
            d = dict(r.doc)
            d["turns"] = [*d.get("turns", []), turn][-MAX_TURNS:]
            d["updated_at"] = _now()
            r.doc = d
            s.commit()
            return d

    def delete_by_project(self, project_id: str) -> int:
        with self.sm() as s:
            rows = s.query(ConversationRecord).filter_by(project_id=project_id).all()
            for r in rows:
                s.delete(r)
            s.commit()
            return len(rows)

    def delete(self, cid: str) -> None:
        with self.sm() as s:
            r = s.get(ConversationRecord, cid)
            if r is None:
                raise NotFoundError(f"Conversation '{cid}' not found")
            s.delete(r)
            s.commit()


class MongoConversationStore:
    def __init__(self, collection):
        self.c = collection
        self.c.create_index("project_id")

    def list(self, project_id: str) -> list[dict]:
        return [_summary(d) for d in self.c.find({"project_id": project_id}).sort("updated_at", -1)]

    def get(self, cid: str) -> dict:
        d = self.c.find_one({"_id": cid})
        if d is None:
            raise NotFoundError(f"Conversation '{cid}' not found")
        d.pop("_id")
        return d

    def create(self, project_id: str, title: str) -> dict:
        d = _new(project_id, title)
        self.c.insert_one({"_id": d["id"], **d})
        return d

    def append(self, cid: str, turn: dict) -> dict:
        if self.c.find_one({"_id": cid}, {"_id": 1}) is None:
            raise NotFoundError(f"Conversation '{cid}' not found")
        self.c.update_one({"_id": cid}, {"$push": {"turns": {"$each": [turn], "$slice": -MAX_TURNS}}, "$set": {"updated_at": _now()}})
        return self.get(cid)

    def delete_by_project(self, project_id: str) -> int:
        return self.c.delete_many({"project_id": project_id}).deleted_count

    def delete(self, cid: str) -> None:
        if self.c.delete_one({"_id": cid}).deleted_count == 0:
            raise NotFoundError(f"Conversation '{cid}' not found")

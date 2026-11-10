"""Project stores (MongoDB or SQL), same interface."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.errors import NotFoundError
from app.schemas.project import Project, ProjectIn

from .database import Base


class ProjectRecord(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    doc: Mapped[dict] = mapped_column(JSON, nullable=False)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _summary(doc: dict) -> dict:
    return {"id": doc["id"], "name": doc["name"], "application": doc.get("application"),
            "description": doc.get("description"), "design_count": len(doc.get("designs", [])),
            "updated_at": doc["updated_at"], "created_at": doc["created_at"]}


def _nf(pid: str) -> NotFoundError:
    return NotFoundError(f"Project '{pid}' not found")


class SqlProjectStore:
    def __init__(self, sessionmaker):
        self.sm = sessionmaker

    def list(self) -> list[dict]:
        with self.sm() as s:
            docs = [r.doc for r in s.query(ProjectRecord).all()]
        return sorted((_summary(d) for d in docs), key=lambda d: d["updated_at"], reverse=True)

    def get(self, pid: str) -> Project:
        with self.sm() as s:
            r = s.get(ProjectRecord, pid)
            if r is None:
                raise _nf(pid)
            return Project.model_validate(r.doc)

    def create(self, p: ProjectIn) -> Project:
        now = _now()
        proj = Project(id=uuid.uuid4().hex[:12], created_at=now, updated_at=now, **p.model_dump(mode="json"))
        with self.sm() as s:
            s.add(ProjectRecord(id=proj.id, doc=proj.model_dump(mode="json")))
            s.commit()
        return proj

    def update(self, pid: str, p: ProjectIn) -> Project:
        with self.sm() as s:
            r = s.get(ProjectRecord, pid)
            if r is None:
                raise _nf(pid)
            proj = Project(id=pid, created_at=r.doc["created_at"], updated_at=_now(), **p.model_dump(mode="json"))
            r.doc = proj.model_dump(mode="json")
            s.commit()
        return proj

    def delete(self, pid: str) -> None:
        with self.sm() as s:
            r = s.get(ProjectRecord, pid)
            if r is None:
                raise _nf(pid)
            s.delete(r)
            s.commit()


class MongoProjectStore:
    def __init__(self, collection):
        self.c = collection
        self.c.create_index("updated_at")

    def list(self) -> list[dict]:
        return [_summary(d) for d in self.c.find({}, {"designs": 1, "id": 1, "name": 1, "application": 1, "description": 1,
                                                       "updated_at": 1, "created_at": 1}).sort("updated_at", -1)]

    def get(self, pid: str) -> Project:
        d = self.c.find_one({"_id": pid})
        if d is None:
            raise _nf(pid)
        d.pop("_id")
        return Project.model_validate(d)

    def create(self, p: ProjectIn) -> Project:
        now = _now()
        proj = Project(id=uuid.uuid4().hex[:12], created_at=now, updated_at=now, **p.model_dump(mode="json"))
        self.c.insert_one({"_id": proj.id, **proj.model_dump(mode="json")})
        return proj

    def update(self, pid: str, p: ProjectIn) -> Project:
        old = self.c.find_one({"_id": pid}, {"created_at": 1})
        if old is None:
            raise _nf(pid)
        proj = Project(id=pid, created_at=old["created_at"], updated_at=_now(), **p.model_dump(mode="json"))
        self.c.replace_one({"_id": pid}, {"_id": pid, **proj.model_dump(mode="json")})
        return proj

    def delete(self, pid: str) -> None:
        if self.c.delete_one({"_id": pid}).deleted_count == 0:
            raise _nf(pid)

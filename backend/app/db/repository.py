"""Cell database stores. Two interchangeable backends with the same interface:
  SqlCellStore    SQLite / PostgreSQL via SQLAlchemy (offline fallback, tests)
  MongoCellStore  MongoDB (e.g. Atlas). Document: {_id: cell id, spec: {...}, origin, created_at}
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from sqlalchemy import select

from app.errors import ConflictError, NotFoundError
from app.schemas.cell import CellSpec

from .database import CellRecord

SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "seed_cells.json"


class CellStore(Protocol):
    backend: str

    def list(self, chemistry: str | None = None) -> list[dict]: ...
    def get(self, cell_id: str) -> CellSpec: ...
    def get_record(self, cell_id: str) -> dict: ...
    def exists(self, cell_id: str) -> bool: ...
    def create(self, cell: CellSpec, origin: str = "user") -> dict: ...
    def delete(self, cell_id: str) -> None: ...


def _not_found(cell_id: str) -> NotFoundError:
    return NotFoundError(f"Cell '{cell_id}' not found in the cell database")


class SqlCellStore:
    backend = "sql"

    def __init__(self, sessionmaker):
        self.sm = sessionmaker

    def list(self, chemistry=None):
        with self.sm() as s:
            rows = s.scalars(select(CellRecord).order_by(CellRecord.id)).all()
            out = [{"origin": r.origin, **r.spec} for r in rows]
        if chemistry:
            out = [c for c in out if c["chemistry"].lower() == chemistry.lower()]
        return out

    def get_record(self, cell_id):
        with self.sm() as s:
            r = s.get(CellRecord, cell_id)
            if r is None:
                raise _not_found(cell_id)
            return {"origin": r.origin, **r.spec}

    def get(self, cell_id):
        rec = self.get_record(cell_id)
        rec.pop("origin")
        return CellSpec.model_validate(rec)

    def exists(self, cell_id):
        with self.sm() as s:
            return s.get(CellRecord, cell_id) is not None

    def create(self, cell, origin="user"):
        spec = cell.model_dump(mode="json")
        with self.sm() as s:
            if s.get(CellRecord, cell.id) is not None:
                raise ConflictError(f"Cell '{cell.id}' already exists")
            s.add(CellRecord(id=cell.id, spec=spec, origin=origin))
            s.commit()
        return {"origin": origin, **spec}

    def delete(self, cell_id):
        with self.sm() as s:
            r = s.get(CellRecord, cell_id)
            if r is None:
                raise _not_found(cell_id)
            if r.origin == "seed":
                raise ConflictError("Seeded cells cannot be deleted through the API")
            s.delete(r)
            s.commit()


class MongoCellStore:
    backend = "mongodb"

    def __init__(self, collection):
        self.c = collection
        self.c.create_index("spec.chemistry")

    def list(self, chemistry=None):
        q = {"spec.chemistry": {"$regex": f"^{re.escape(chemistry)}$", "$options": "i"}} if chemistry else {}
        return [{"origin": d["origin"], **d["spec"]} for d in self.c.find(q).sort("_id", 1)]

    def get_record(self, cell_id):
        d = self.c.find_one({"_id": cell_id})
        if d is None:
            raise _not_found(cell_id)
        return {"origin": d["origin"], **d["spec"]}

    def get(self, cell_id):
        rec = self.get_record(cell_id)
        rec.pop("origin")
        return CellSpec.model_validate(rec)

    def exists(self, cell_id):
        return self.c.find_one({"_id": cell_id}, {"_id": 1}) is not None

    def create(self, cell, origin="user"):
        from pymongo.errors import DuplicateKeyError

        spec = cell.model_dump(mode="json")
        try:
            self.c.insert_one({"_id": cell.id, "spec": spec, "origin": origin, "created_at": datetime.now(timezone.utc)})
        except DuplicateKeyError as e:
            raise ConflictError(f"Cell '{cell.id}' already exists") from e
        return {"origin": origin, **spec}

    def delete(self, cell_id):
        d = self.c.find_one({"_id": cell_id}, {"origin": 1})
        if d is None:
            raise _not_found(cell_id)
        if d["origin"] == "seed":
            raise ConflictError("Seeded cells cannot be deleted through the API")
        self.c.delete_one({"_id": cell_id})


def seed(store: CellStore) -> int:
    """Insert seed cells that are not already present (idempotent)."""
    data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    n = 0
    for raw in data["cells"]:
        cell = CellSpec.model_validate(raw)
        if not store.exists(cell.id):
            store.create(cell, origin="seed")
            n += 1
    return n

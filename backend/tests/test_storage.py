"""Cell storage backends and backend selection.

The live MongoDB test is opt-in (it writes to a separate 'batteryx_test' database and drops it):
    $env:BATTERYX_TEST_MONGO = "1"; python -m pytest tests/test_storage.py -q
"""
import os
import re

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, load_settings, redact
from app.db.repository import MongoCellStore, seed
from app.errors import ConflictError, NotFoundError
from app.main import create_app
from app.schemas.cell import CellSpec

from .conftest import SYNTHETIC_CELL


class FakeCollection:
    """Minimal in-memory stand-in for a pymongo collection (only the calls MongoCellStore uses)."""

    def __init__(self):
        self.docs = {}

    def create_index(self, *_a, **_k):
        return "idx"

    def insert_one(self, doc):
        from pymongo.errors import DuplicateKeyError
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("dup")
        self.docs[doc["_id"]] = dict(doc)

    def find_one(self, q, proj=None):
        return self.docs.get(q["_id"])

    def find(self, q):
        docs = list(self.docs.values())
        if q:
            pat = q["spec.chemistry"]["$regex"]
            docs = [d for d in docs if re.match(pat, d["spec"]["chemistry"], re.I)]
        return _Cursor(docs)

    def delete_one(self, q):
        self.docs.pop(q["_id"], None)


class _Cursor(list):
    def sort(self, key, direction):
        return sorted(self, key=lambda d: d[key], reverse=direction < 0)


def test_mongo_store_crud_and_seed():
    store = MongoCellStore(FakeCollection())
    assert seed(store) == 1 and seed(store) == 0          # idempotent
    store.create(CellSpec.model_validate(SYNTHETIC_CELL))
    assert [c["id"] for c in store.list()] == ["EXAMPLE-LFP-20AH", "TEST-SYNTHETIC"]
    assert [c["id"] for c in store.list("lfp")] == ["EXAMPLE-LFP-20AH"]
    assert store.get("TEST-SYNTHETIC").capacity_ah == 10
    with pytest.raises(ConflictError):
        store.create(CellSpec.model_validate(SYNTHETIC_CELL))
    with pytest.raises(ConflictError):
        store.delete("EXAMPLE-LFP-20AH")                  # seed protected
    store.delete("TEST-SYNTHETIC")
    with pytest.raises(NotFoundError):
        store.get("TEST-SYNTHETIC")


def test_auto_without_uri_uses_sql():
    app = create_app(settings=Settings(db_backend="auto", mongodb_uri=None, database_url="sqlite://"))
    assert TestClient(app).get("/health").json()["database"]["backend"] == "sql"


def test_auto_falls_back_when_mongo_unreachable():
    s = Settings(db_backend="auto", mongodb_uri="mongodb://user:secret@127.0.0.1:1/?serverSelectionTimeoutMS=300",
                 database_url="sqlite://")
    db = TestClient(create_app(settings=s)).get("/health").json()["database"]
    assert db["backend"] == "sql" and "fallback_reason" in db
    assert "secret" not in str(db)                         # credentials never exposed


def test_mongo_mode_fails_fast_without_uri():
    with pytest.raises(RuntimeError, match="MONGODB_URI"):
        create_app(settings=Settings(db_backend="mongo", mongodb_uri=None))


def test_redact():
    assert redact("mongodb+srv://u:p@host.net/db") == "mongodb+srv://***@host.net/db"


@pytest.mark.skipif(os.getenv("BATTERYX_TEST_MONGO") != "1", reason="live MongoDB test is opt-in")
def test_live_mongodb_roundtrip():
    from pymongo import MongoClient
    base = load_settings()
    assert base.mongodb_uri, "MONGODB_URI not configured"
    s = Settings(db_backend="mongo", mongodb_uri=base.mongodb_uri, mongodb_db="batteryx_test")
    try:
        c = TestClient(create_app(settings=s))
        assert c.get("/health").json()["database"]["backend"] == "mongodb"
        assert c.post("/api/v1/cells", json=SYNTHETIC_CELL).status_code == 201
        assert c.get("/api/v1/cells/TEST-SYNTHETIC").json()["capacity_ah"] == 10
        r = c.post("/api/v1/designs/evaluate", json={"name": "live", "cell_id": "EXAMPLE-LFP-20AH", "series": 4, "parallel": 1})
        assert r.status_code == 200
    finally:
        MongoClient(base.mongodb_uri, serverSelectionTimeoutMS=8000).drop_database("batteryx_test")

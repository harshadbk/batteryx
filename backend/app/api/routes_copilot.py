"""Claude engineering copilot endpoints (prefix /api/v1/copilot)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from app.ai.copilot import MODES, run_turn
from app.errors import AppError
from app.ratelimit import ai_rate_limit

router = APIRouter(prefix="/api/v1/copilot", tags=["copilot"])

Mode = Literal["design_copilot", "analyst", "safety", "optimizer", "report"]


class ChatRequest(BaseModel):
    mode: Mode
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    focus_design: str | None = Field(None, max_length=100)


class ConversationMismatch(AppError):
    status, code = 409, "conversation_mismatch"


@router.get("/status", summary="Copilot configuration (never returns the API key)")
def copilot_status(request: Request):
    c = request.app.state.claude
    return {"configured": c.configured, "provider": getattr(c, "provider", "anthropic"), "model": c.model, "effort": c.effort,
            "server_side_fallback": c.use_fallbacks,
            "modes": {k: v["label"] for k, v in MODES.items()}}


@router.get("/projects/{pid}/conversations", summary="Copilot conversations of a project")
def list_conversations(pid: str, request: Request):
    request.app.state.projects.get(pid)
    return request.app.state.conversations.list(pid)


@router.get("/conversations/{cid}", summary="One conversation with all turns")
def get_conversation(cid: str, request: Request):
    return request.app.state.conversations.get(cid)


@router.delete("/conversations/{cid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(cid: str, request: Request):
    request.app.state.conversations.delete(cid)


@router.post("/projects/{pid}/chat", dependencies=[Depends(ai_rate_limit)], summary="One copilot turn: Claude + engine tools + verification")
def chat(pid: str, req: ChatRequest, request: Request):
    st = request.app.state
    project = st.projects.get(pid).model_dump(mode="json")
    if req.focus_design and not any(d.get("name") == req.focus_design for d in project["designs"]):
        raise AppError(f"Design '{req.focus_design}' is not in this project")
    if req.conversation_id:
        conv = st.conversations.get(req.conversation_id)
        if conv["project_id"] != pid:
            raise ConversationMismatch("Conversation belongs to another project")
    else:
        conv = st.conversations.create(pid, req.message)
    turn = run_turn(st.claude, project=project, cell_store=st.cells, mode=req.mode, message=req.message,
                    focus_design=req.focus_design, history=conv.get("turns", []))
    record = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "message": req.message,
              "focus_design": req.focus_design, **turn}
    st.conversations.append(conv["id"], record)
    return {"conversation_id": conv["id"], "turn": record}

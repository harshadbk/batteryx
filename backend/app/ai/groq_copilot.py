"""Groq backend for the engineering copilot.

Exposes the same `create(**params)` interface as ClaudeClient and returns Anthropic-shaped responses
(content blocks of type "text"/"tool_use", stop_reason, usage), so the copilot loop, tools and verifier in
copilot.py run unchanged. Requests are translated to Groq's OpenAI-compatible chat-completions API with
function calling. The GROQ_API_KEY stays on the server (it is held by LLMClient and never returned).
"""
from __future__ import annotations

import json
import os
import re
from types import SimpleNamespace as NS

from .llm import AIProviderError, LLMClient

_DEFAULTS = {"string": "", "array": [], "boolean": False, "number": None, "object": {}}


def _text_block(text: str):
    return NS(type="text", text=text)


def _tool_block(call_id: str, name: str, args: dict):
    return NS(type="tool_use", id=call_id, name=name, input=args)


def _extract_json(text: str) -> dict | None:
    """The model's final answer as a JSON object (tolerates code fences or prose around it)."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        v = json.loads(t)
        return v if isinstance(v, dict) else None
    except json.JSONDecodeError:
        pass
    start, end = t.find("{"), t.rfind("}")
    if start != -1 and end > start:
        try:
            v = json.loads(t[start:end + 1])
            return v if isinstance(v, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def _fill_required(obj: dict, schema: dict) -> dict:
    """Add any top-level required field the model omitted, with an empty value of the right type."""
    props = schema.get("properties", {})
    for k in schema.get("required", []):
        if k not in obj:
            typ = props.get(k, {}).get("type", "string")
            obj[k] = list(_DEFAULTS[typ]) if typ == "array" else _DEFAULTS.get(typ, "")
    return obj


def _nullable(prop: dict) -> bool:
    if prop.get("type") == "null" or (isinstance(prop.get("type"), list) and "null" in prop["type"]):
        return True
    return any(_nullable(x) for x in prop.get("anyOf", []))


def _relax(schema):
    """Strict (Claude-style) schemas list every field as required, nullable ones included. Groq validates tool
    arguments server-side and rejects omitted fields, so nullable fields become optional (filled with null later)."""
    if isinstance(schema, list):
        return [_relax(x) for x in schema]
    if not isinstance(schema, dict):
        return schema
    out = {k: _relax(v) for k, v in schema.items()}
    props = schema.get("properties")
    if isinstance(props, dict) and "required" in schema:
        out["required"] = [k for k in schema["required"] if not _nullable(props.get(k, {}))]
    return out


def _nullable_fields(schema: dict) -> list[str]:
    props = schema.get("properties", {})
    return [k for k in schema.get("required", []) if _nullable(props.get(k, {}))]


# ---------------------------------------------------------------- prompt compaction
# Groq's free tier caps requests at a few thousand tokens per minute, so the Groq path sends a compact view of the
# same information. The verifier still checks the answer against the full, unrounded tool results.

def _compact_params(schema, top: bool = True):
    """Tool parameter schema without nested descriptions / additionalProperties (the tool's own description stays)."""
    if isinstance(schema, list):
        return [_compact_params(x, False) for x in schema]
    if not isinstance(schema, dict):
        return schema
    return {k: _compact_params(v, k == "properties") for k, v in schema.items()
            if k != "additionalProperties" and not (k == "description" and not top and isinstance(v, str))}


def _skeleton(schema):
    """Short type sketch of a JSON schema, e.g. {"claims":[{"value":"number|null"}]}."""
    if "anyOf" in schema:
        return "|".join(str(_skeleton(x)) for x in schema["anyOf"])
    t = schema.get("type")
    if t == "object":
        return {k: _skeleton(v) for k, v in schema.get("properties", {}).items()}
    if t == "array":
        return [_skeleton(schema.get("items", {}))]
    if "enum" in schema:
        return "|".join(map(str, schema["enum"]))
    return t or "any"


def _round(v):
    if isinstance(v, float):
        return float(f"{v:.4g}")
    if isinstance(v, list):
        return [_round(x) for x in v]
    if isinstance(v, dict):
        return {k: _round(x) for k, x in v.items()}
    return v


def _compact_result(text: str) -> str:
    """Tool result for the model: numbers to 4 significant figures (verifier tolerance is 1 %), compact JSON."""
    try:
        return json.dumps(_round(json.loads(text)), ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return text


def _content_to_text(content) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(getattr(b, "text", None) or (b.get("text", "") if isinstance(b, dict) else "") for b in content)


class GroqCopilotClient:
    provider = "groq"
    effort = None
    use_fallbacks = False

    def __init__(self, llm: LLMClient, max_tokens: int = 2500):
        self.llm = llm
        self.max_tokens = max_tokens
        # Groq free tier: 8,000 tokens/minute, counting prompt + requested output. Output gets whatever the prompt leaves.
        self.token_limit = int(os.getenv("BATTERYX_GROQ_TOKEN_LIMIT", "8000"))
        self.prompt_budget = int(os.getenv("BATTERYX_GROQ_PROMPT_BUDGET", "5200"))
        self.max_tool_rounds = 4
        self._null_fields: dict[str, list[str]] = {}

    @property
    def model(self) -> str:
        return self.llm.model

    @property
    def configured(self) -> bool:
        return self.llm.configured

    # ------------------------------------------------------------------ translation
    def _tools(self, tools: list[dict]) -> list[dict]:
        out = []
        for t in tools or []:
            schema = t.get("input_schema", {"type": "object", "properties": {}})
            self._null_fields[t["name"]] = _nullable_fields(schema)
            out.append({"type": "function", "function": {"name": t["name"], "description": t.get("description", ""),
                                                         "parameters": _compact_params(_relax(schema))}})
        return out

    @staticmethod
    def _messages(system, messages: list[dict], schema: dict | None) -> list[dict]:
        sys_text = _content_to_text(system) if system else ""
        if schema:
            sys_text += ("\n\nFINAL ANSWER FORMAT: when you are done calling tools, reply with ONLY one JSON object (no prose, "
                         "no code fences) with exactly these keys and value types (\"a|b\" = one of; [x] = list of x):\n"
                         + json.dumps(_skeleton(schema), separators=(",", ":")))
        out = [{"role": "system", "content": sys_text}] if sys_text else []
        for m in messages:
            c = m["content"]
            if m["role"] == "assistant":
                if isinstance(c, str):
                    out.append({"role": "assistant", "content": c})
                    continue
                text = "\n".join(b.text for b in c if getattr(b, "type", None) == "text" and b.text)
                calls = [{"id": b.id, "type": "function", "function": {"name": b.name, "arguments": json.dumps(b.input)}}
                         for b in c if getattr(b, "type", None) == "tool_use"]
                msg = {"role": "assistant", "content": text or None}
                if calls:
                    msg["tool_calls"] = calls
                out.append(msg)
            elif isinstance(c, str):
                out.append({"role": "user", "content": c})
            else:  # list of tool_result blocks
                for b in c:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": _compact_result(b["content"])})
                    else:
                        out.append({"role": "user", "content": _content_to_text([b])})
        return out

    def _fit(self, msgs: list[dict], tools) -> list[dict]:
        """Keep one request under the prompt budget (Groq rejects requests above the account's per-minute token
        limit outright). Oldest tool results are shortened first; the model can call a tool again if it needs them."""
        tool_chars = len(json.dumps(self._tools(tools))) if tools else 0
        # count raw text (json.dumps of the list would double-escape the JSON inside tool results)
        size = lambda m: len(m.get("content") or "") + len(json.dumps(m.get("tool_calls") or ""))
        est = lambda: (sum(size(m) for m in msgs) + tool_chars) / 3.5
        for m in msgs:
            if est() <= self.prompt_budget:
                break
            if m["role"] == "tool" and len(m["content"]) > 400:
                m["content"] = m["content"][:300] + '..."[truncated to fit the token limit]"'
        self._prompt_est = est()
        return msgs

    def _out_limit(self) -> int:
        """Output tokens for this request: the room left under the per-minute limit (min max_tokens, max 6000)."""
        room = int(self.token_limit - getattr(self, "_prompt_est", 0) - 300)
        return max(self.max_tokens, min(room, 6000))

    @staticmethod
    def _mode_tools(tools: list[dict] | None, messages: list[dict]) -> list[dict] | None:
        """Only the tools the active capability's instruction names (plus get_project_designs), to save tokens."""
        if not tools:
            return tools
        cap = next((m["content"] for m in reversed(messages)
                    if m["role"] == "user" and isinstance(m["content"], str) and "<capability>" in m["content"]), "")
        cap = cap[cap.find("<capability>"):cap.find("</capability>")]
        picked = [t for t in tools if t["name"] in cap or t["name"] == "get_project_designs"]
        return picked if len(picked) > 1 else tools

    def _post_with_tool_retry(self, body: dict) -> dict:
        """Groq validates tool calls server-side and fails the whole request (400 tool_use_failed) when the model
        omits a required argument. Retry up to twice, telling the model what was wrong."""
        for attempt in range(3):
            try:
                return self.llm.post(body)
            except AIProviderError as e:
                detail = str(e.details or "")
                if "tool_use_failed" not in detail or attempt == 2:
                    raise
                m = re.search(r'"message":"([^"]{0,300})', detail)
                hint = m.group(1) if m else "a tool call did not match its schema"
                body = {**body, "messages": body["messages"] + [{"role": "user", "content":
                        f"Your previous tool call was rejected: {hint}. Call the tool again with ALL required arguments "
                        "(for simulate: mode must be 'charge' or 'discharge')."}]}
        raise AssertionError("unreachable")

    # ------------------------------------------------------------------ call
    def create(self, *, system=None, tools=None, messages, output_config=None, **_ignored):
        schema = ((output_config or {}).get("format") or {}).get("schema")
        tools = self._mode_tools(tools, messages)
        msgs = self._messages(system, messages, schema)
        rounds = sum(1 for m in msgs if m["role"] == "assistant" and m.get("tool_calls"))
        if rounds >= self.max_tool_rounds:  # enough data gathered: make the model answer now
            tools = None
            msgs.append({"role": "user", "content": "You have the tool results you need. Do not call more tools: "
                                                    "return the final answer JSON now, citing the refs above."})
        body = {"model": self.model, "messages": self._fit(msgs, tools),
                "temperature": 0.1}
        body["max_completion_tokens"] = self._out_limit()
        if tools:
            body["tools"] = self._tools(tools)
            body["tool_choice"] = "auto"
        data = self._post_with_tool_retry(body)
        usage = data.get("usage") or {}
        u = NS(input_tokens=usage.get("prompt_tokens", 0), output_tokens=usage.get("completion_tokens", 0), cache_read_input_tokens=0)
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        finish = choice.get("finish_reason")

        calls = msg.get("tool_calls") or []
        if calls:
            blocks = [_text_block(msg["content"])] if msg.get("content") else []
            for tc in calls:
                fn = tc.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                args = args if isinstance(args, dict) else {}
                for k in self._null_fields.get(fn.get("name"), []):
                    args.setdefault(k, None)
                blocks.append(_tool_block(tc.get("id"), fn.get("name"), args))
            return NS(content=blocks, stop_reason="tool_use", usage=u)

        if finish == "length":
            return NS(content=[_text_block(msg.get("content") or "")], stop_reason="max_tokens", usage=u)

        text = msg.get("content") or ""
        if schema:
            obj = _extract_json(text)
            if obj is None:  # one repair call in JSON mode, without tools
                fix = self.llm.post({"model": self.model, "temperature": 0, "max_completion_tokens": self._out_limit(),
                                     "response_format": {"type": "json_object"},
                                     "messages": body["messages"] + [{"role": "assistant", "content": text},
                                                                     {"role": "user", "content": "Return your final answer now as ONLY the JSON object required by the FINAL ANSWER FORMAT."}]})
                obj = _extract_json(((fix.get("choices") or [{}])[0].get("message") or {}).get("content") or "")
            if obj is not None:
                text = json.dumps(_fill_required(obj, schema), ensure_ascii=False)
        return NS(content=[_text_block(text)], stop_reason="end_turn", usage=u)

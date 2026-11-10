"""LLM provider adapter. Groq (OpenAI-compatible chat completions) today; the interface is
provider-neutral so another provider (e.g. Claude) can be added behind the same `chat` call."""
from __future__ import annotations

import re
import time

import httpx

from app.config import redact
from app.errors import AppError

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


class AIUnavailable(AppError):
    status, code = 503, "ai_unavailable"


class AIProviderError(AppError):
    status, code = 502, "ai_provider_error"


class AIRateLimited(AppError):
    status, code = 429, "ai_rate_limited"


def _duration_s(text: str | None) -> float | None:
    """Parse Groq durations such as '12.5s', '1m2.3s', '850ms' or a plain number of seconds."""
    if not text:
        return None
    text = text.strip()
    try:
        return float(text)
    except ValueError:
        pass
    m = re.fullmatch(r"(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?|(\d+(?:\.\d+)?)ms", text)
    if not m or not any(m.groups()):
        return None
    if m.group(3):
        return float(m.group(3)) / 1000
    return float(m.group(1) or 0) * 60 + float(m.group(2) or 0)


def _retry_wait(r) -> float | None:
    """Seconds to wait before retrying a 429: Retry-After header, else the 'try again in …' hint in the body."""
    wait = _duration_s(r.headers.get("retry-after"))
    if wait is None:
        m = re.search(r"try again in ((?:\d+(?:\.\d+)?m)?\d+(?:\.\d+)?m?s)", r.text)
        wait = _duration_s(m.group(1)) if m else None
    return None if wait is None else wait + 0.5


class LLMClient:
    def __init__(self, api_key: str | None, model: str, provider: str = "groq", timeout_s: float = 60.0, max_wait_s: float = 65.0):
        self.api_key = api_key
        self.model = model
        self.provider = provider
        self.timeout_s = timeout_s
        self.max_wait_s = max_wait_s

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def chat(self, messages: list[dict], *, json_mode: bool = False, temperature: float = 0.1, max_tokens: int = 1500) -> str:
        if not self.configured:
            raise AIUnavailable("AI assistant not configured: set GROQ_API_KEY in backend/.env")
        body = {"model": self.model, "messages": messages, "temperature": temperature, "max_completion_tokens": max_tokens}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        data = self.post(body)
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise AIProviderError("Unexpected AI provider response format") from None

    def post(self, body: dict) -> dict:
        """One chat-completions request (OpenAI-compatible). Retries once on a short rate-limit wait."""
        if not self.configured:
            raise AIUnavailable("AI not configured: set GROQ_API_KEY in backend/.env and restart the server.")
        attempts = 4
        for attempt in range(1, attempts + 1):
            try:
                r = httpx.post(GROQ_URL, json=body, timeout=self.timeout_s,
                               headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"})
            except httpx.HTTPError as e:
                raise AIProviderError(f"AI provider unreachable: {redact(type(e).__name__)}") from None
            if r.status_code != 429:
                break
            wait = _retry_wait(r)
            if attempt == attempts or wait is None or wait > self.max_wait_s:
                if wait and wait > 120:
                    msg = f"AI provider token quota used up (likely the daily limit). Retry in about {round(wait / 60)} min."
                else:
                    msg = "AI provider rate limit reached (tokens per minute). Wait a minute and retry."
                raise AIRateLimited(msg, {"retry_after_s": round(wait, 1) if wait else None})
            time.sleep(wait)
        if r.status_code == 413:
            raise AIRateLimited("Request too large for the Groq free tier token limit. Ask a narrower question or retry in a minute.")
        if r.status_code != 200:
            detail = redact(r.text[:300]).replace(self.api_key, "***")
            raise AIProviderError(f"AI provider returned HTTP {r.status_code}", detail)
        try:
            return r.json()
        except ValueError:
            raise AIProviderError("Unexpected AI provider response format") from None

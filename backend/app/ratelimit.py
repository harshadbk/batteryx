"""In-process sliding-window rate limit for the paid AI endpoints (per client IP).

Protects the Claude / Groq budget from loops and abuse in a single-server deployment.
For multiple workers or servers use a shared store (e.g. Redis) instead."""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.errors import AppError


class TooManyRequests(AppError):
    status, code = 429, "rate_limited"


class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key: str) -> None:
        if self.per_minute <= 0:
            return
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                raise TooManyRequests(f"AI request limit reached ({self.per_minute} per minute). Try again shortly.",
                                      {"retry_after_s": round(60 - (now - q[0]), 1)})
            q.append(now)


def ai_rate_limit(request: Request) -> None:
    limiter: RateLimiter | None = getattr(request.app.state, "ai_limiter", None)
    if limiter is None:
        limiter = request.app.state.ai_limiter = RateLimiter(int(os.getenv("BATTERYX_AI_RATE_PER_MIN", "12")))
    limiter.check(request.client.host if request.client else "unknown")

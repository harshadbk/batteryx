"""Claude API client wrapper (official `anthropic` SDK).

- Credentials come only from the environment (ANTHROPIC_API_KEY, loaded from backend/.env); the key is
  never logged, returned to the frontend, or stored.
- Typed error chain → BatteryX error envelope (429 rate limit with retry-after, 503 auth/config, 502 provider).
- Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) is on by default;
  a remaining refusal is surfaced as an explicit error, never parsed as an answer.
"""
from __future__ import annotations

import os

import anthropic

from app.errors import AppError

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ClaudeUnavailable(AppError):
    status, code = 503, "ai_unavailable"


class ClaudeRateLimited(AppError):
    status, code = 429, "ai_rate_limited"


class ClaudeProviderError(AppError):
    status, code = 502, "ai_provider_error"


class ClaudeRefused(AppError):
    status, code = 422, "ai_refused"


def _key_present() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


class ClaudeClient:
    """Thin wrapper so the copilot loop (and tests) depend on one `create(**params)` call."""

    provider = "anthropic"

    def __init__(self, model: str | None = None, effort: str | None = None, sdk_client=None,
                 use_fallbacks: bool = True):
        self.model = model or os.getenv("BATTERYX_CLAUDE_MODEL", DEFAULT_MODEL)
        self.effort = effort or os.getenv("BATTERYX_CLAUDE_EFFORT", "medium")
        self.use_fallbacks = use_fallbacks and os.getenv("BATTERYX_CLAUDE_FALLBACKS", "1") != "0"
        self._sdk = sdk_client  # injected in tests

    @property
    def configured(self) -> bool:
        return self._sdk is not None or _key_present()

    def _client(self):
        if self._sdk is None:
            if not _key_present():
                raise ClaudeUnavailable("Claude is not configured: set ANTHROPIC_API_KEY in backend/.env and restart the server.")
            self._sdk = anthropic.Anthropic(max_retries=3, timeout=180.0)
        return self._sdk

    def create(self, **params):
        """One Messages API call. Retries for 429/5xx/connection errors are done by the SDK (max_retries=3)."""
        client = self._client()
        params = {"model": self.model, "max_tokens": 16000, **params}
        params.setdefault("output_config", {})
        params["output_config"] = {"effort": self.effort, **params["output_config"]}
        try:
            if self.use_fallbacks:
                resp = client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **params)
            else:
                resp = client.messages.create(**params)
        except anthropic.AuthenticationError:
            raise ClaudeUnavailable("Claude rejected the API key (401). Check ANTHROPIC_API_KEY in backend/.env.") from None
        except anthropic.PermissionDeniedError:
            raise ClaudeUnavailable("The API key lacks permission for this model (403).") from None
        except anthropic.NotFoundError:
            raise ClaudeProviderError(f"Model '{self.model}' not found (404). Check BATTERYX_CLAUDE_MODEL.") from None
        except anthropic.RateLimitError as e:
            retry = e.response.headers.get("retry-after") if e.response is not None else None
            raise ClaudeRateLimited("Claude rate limit reached after automatic retries. Try again shortly.",
                                    {"retry_after_s": retry}) from None
        except anthropic.BadRequestError as e:
            raise ClaudeProviderError("Claude rejected the request (400).", getattr(e, "message", None)) from None
        except anthropic.APIStatusError as e:
            raise ClaudeProviderError(f"Claude API error ({e.status_code}); the service may be overloaded. Retry later.") from None
        except anthropic.APIConnectionError:
            raise ClaudeProviderError("Could not reach the Claude API (network error).") from None

        if resp.stop_reason == "refusal":
            cat = getattr(getattr(resp, "stop_details", None), "category", None)
            raise ClaudeRefused("Claude declined this request.", {"category": cat})
        return resp

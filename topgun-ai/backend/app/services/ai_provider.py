"""AI provider abstraction.

Topgun AI must not hardcode a single LLM or embedding vendor. This module
defines the interface all ingestion and query code depends on, plus three
implementations:

- ``StubProvider`` — deterministic, zero-dependency, always available.
- ``OpenAIProvider`` — placeholder wired behind ``AI_PROVIDER=openai``.
- ``AnthropicProvider`` — placeholder wired behind ``AI_PROVIDER=anthropic``.

The real API clients are intentionally not imported at module load time so
the MVP runs with no optional dependencies installed. When a caller picks
a non-stub provider without the matching SDK installed, the factory raises
a clear, actionable error.
"""
from __future__ import annotations

import hashlib
import struct
from typing import Any, Protocol

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


class AIProvider(Protocol):
    name: str

    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return an embedding vector for each input string."""

    def synthesize(self, prompt: str, *, schema: dict[str, Any]) -> dict[str, Any]:
        """Return a JSON-shaped answer that matches ``schema``."""


# ---------------------------------------------------------------------------
class StubProvider:
    """Deterministic provider used in demo mode and tests.

    Embeddings are simple hashed buckets so similarity between two strings
    is reproducible across processes without any network calls. The
    ``synthesize`` method is unused in demo mode (the query engine fills
    in the answer from the demo store); it returns a shape-correct
    placeholder so tests can still exercise the plumbing.
    """

    name = "stub"

    def embed(self, texts: list[str]) -> list[list[float]]:
        dim = get_settings().embedding_dimensions
        return [_hashed_vector(t, dim) for t in texts]

    def synthesize(self, prompt: str, *, schema: dict[str, Any]) -> dict[str, Any]:
        return {
            "answer": "Stub provider: plug in OpenAI or Anthropic to generate answers.",
            "sections": [],
            "confidence": {
                "score": 0.5,
                "label": "medium",
                "reason": "Stub provider response.",
            },
        }


# ---------------------------------------------------------------------------
class OpenAIProvider:
    """OpenAI-backed implementation.

    Intentionally lazy-imports the SDK so the MVP runs without ``openai``
    installed. Implementation will be filled in during Phase 2.
    """

    name = "openai"

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        try:
            import openai  # noqa: F401  # pragma: no cover
        except ImportError as exc:  # pragma: no cover - exercised only when enabled
            raise RuntimeError(
                "openai package is not installed. Add `openai` to requirements.txt "
                "to enable AI_PROVIDER=openai."
            ) from exc
        self._api_key = api_key

    def embed(self, texts: list[str]) -> list[list[float]]:  # pragma: no cover
        raise NotImplementedError("OpenAIProvider.embed is wired in Phase 2")

    def synthesize(  # pragma: no cover
        self, prompt: str, *, schema: dict[str, Any]
    ) -> dict[str, Any]:
        raise NotImplementedError("OpenAIProvider.synthesize is wired in Phase 2")


# ---------------------------------------------------------------------------
class AnthropicProvider:
    """Anthropic-backed implementation for structured answer synthesis."""

    name = "anthropic"

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        try:
            import anthropic  # noqa: F401  # pragma: no cover
        except ImportError as exc:  # pragma: no cover - exercised only when enabled
            raise RuntimeError(
                "anthropic package is not installed. Add `anthropic` to requirements.txt "
                "to enable AI_PROVIDER=anthropic."
            ) from exc
        self._api_key = api_key

    def embed(self, texts: list[str]) -> list[list[float]]:  # pragma: no cover
        raise NotImplementedError(
            "AnthropicProvider does not provide embeddings; use OpenAI or a local model."
        )

    def synthesize(  # pragma: no cover
        self, prompt: str, *, schema: dict[str, Any]
    ) -> dict[str, Any]:
        raise NotImplementedError("AnthropicProvider.synthesize is wired in Phase 2")


# ---------------------------------------------------------------------------
def get_ai_provider() -> AIProvider:
    settings = get_settings()
    choice = settings.ai_provider
    if choice == "openai":
        return OpenAIProvider(api_key=settings.openai_api_key)
    if choice == "anthropic":
        return AnthropicProvider(api_key=settings.anthropic_api_key)
    return StubProvider()


# ---------------------------------------------------------------------------
def _hashed_vector(text: str, dim: int) -> list[float]:
    """Tiny deterministic "embedding" for the stub provider.

    This is a deterministic local fallback (NOT semantically meaningful).
    Documented as fallback quality only — Phase 2 wires real embeddings.
    """
    vec = [0.0] * dim
    for token in text.lower().split():
        digest = hashlib.sha1(token.encode("utf-8")).digest()
        # fold the 20 bytes of the digest into ``dim`` buckets
        for i in range(0, 20, 4):
            (value,) = struct.unpack(">I", digest[i : i + 4])
            vec[value % dim] += 1.0
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]

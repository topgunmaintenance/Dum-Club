"""
Shared agent protocol + result envelope.

Intentionally minimal. We do not depend on LangChain, CrewAI, or any other
agent framework. If we need richer tool-calling later we can swap this out
for something heavier — but for now, a dataclass + a Protocol keeps the
surface area honest and every agent trivially unit-testable.

Contract:
    - An Agent is a callable with `async def run(self, payload: dict) -> AgentResult`.
    - run() must never raise for expected business conditions (empty query,
      upstream provider off, dedup hit, etc.). It returns an AgentResult
      with an appropriate `status`.
    - run() MAY raise for programmer errors (bad types) or unrecoverable
      infra problems that the caller must surface.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable


AgentStatus = Literal["ok", "review", "reject", "empty", "error"]


@dataclass
class AgentResult:
    """
    Structured envelope every agent returns.

    status:
        "ok"     — agent produced a usable result
        "review" — agent wants a human (admin) to take a look
        "reject" — agent explicitly rejected the input
        "empty"  — agent ran successfully but produced no data (e.g. no matches)
        "error"  — agent hit an infra issue and the caller should decide what to do
    data:
        Agent-specific payload. Shape is documented by the individual agent.
    confidence:
        0.0 – 1.0. For agents that produce a single decision (proof verification,
        rewards). Discovery agents leave this at 0.0 and put per-item confidence
        inside `data`.
    reason:
        Short machine-friendly string the caller can log or surface.
    logs:
        Chronological list of agent log lines. The base agent writes these
        via self.log(); tests assert on them.
    """

    status: AgentStatus
    data: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0
    reason: str = ""
    logs: list[str] = field(default_factory=list)


@runtime_checkable
class Agent(Protocol):
    """Structural type for all agents."""

    name: str

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        ...


class BaseAgent:
    """
    Optional convenience base. Agents can inherit from this or implement the
    Protocol directly — both are fine.
    """

    name: str = "base"

    def __init__(self) -> None:
        self._logs: list[str] = []

    def log(self, msg: str) -> None:
        """Record a log line and also mirror it to stdout for ops."""
        line = f"[agent:{self.name}] {msg}"
        self._logs.append(line)
        print(line)

    def _drain_logs(self) -> list[str]:
        """Return and clear accumulated log lines. Called at end of run()."""
        out = list(self._logs)
        self._logs.clear()
        return out

"""
DUM Club agent layer.

Thin, deterministic, testable modules that implement the Off-Platform →
On-Platform Growth Engine described in product.md. Agents are called from
the route layer (api/routes/...), not the other way around. Each agent is
framework-free: no LLM calls, no OCR, no network unless explicitly injected,
and every external dependency (Supabase, Places) is passed in so tests can
mock them.

Currently shipped:
    - base.Agent / base.AgentResult
    - local_discovery.LocalDiscoveryAgent

Planned (future PRs, do not build here):
    - purchase_proof.PurchaseProofAgent
    - rewards.RewardsAgent
"""

from services.agents.base import Agent, AgentResult

__all__ = ["Agent", "AgentResult"]

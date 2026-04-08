"""
Feature flags for DUM Club.

Controls rollout of new features. All flags default to safe/off states.
Read from environment variables with fallback defaults.
"""

import os

from fastapi import APIRouter

router = APIRouter()

# ── Flag definitions (env var → default) ──

_FLAGS = {
    "external_local_search_enabled": ("EXTERNAL_LOCAL_SEARCH_ENABLED", False),
    "off_platform_receipt_rewards_enabled": ("OFF_PLATFORM_RECEIPT_REWARDS_ENABLED", False),
    "merchant_outreach_queue_enabled": ("MERCHANT_OUTREACH_QUEUE_ENABLED", False),
    "merchant_outreach_send_enabled": ("MERCHANT_OUTREACH_SEND_ENABLED", False),
    # Off-Platform → On-Platform Growth Engine agents
    "local_discovery_agent_enabled": ("LOCAL_DISCOVERY_AGENT_ENABLED", False),
}


def get_flag(name: str) -> bool:
    """Get a feature flag value. Returns False for unknown flags."""
    if name not in _FLAGS:
        return False
    env_var, default = _FLAGS[name]
    val = os.getenv(env_var, "")
    if val.lower() in ("1", "true", "yes"):
        return True
    if val.lower() in ("0", "false", "no"):
        return False
    return default


@router.get("/flags")
async def list_flags():
    """Return all feature flag states. Safe for frontend consumption."""
    return {name: get_flag(name) for name in _FLAGS}

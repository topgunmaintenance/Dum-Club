"""
Live streaming cost protection and rate limiting.

Configurable limits — can be adjusted via env vars.
"""
import os
import time
from typing import Dict, Tuple
from collections import defaultdict

# ── Configurable Limits ──────────────────────────────────────

MAX_STREAM_DURATION_MINUTES = int(os.getenv("MAX_STREAM_DURATION_MINUTES", "60"))
MAX_STREAMS_PER_DAY = int(os.getenv("MAX_STREAMS_PER_DAY", "3"))
MAX_VIEWERS_PER_STREAM = int(os.getenv("MAX_VIEWERS_PER_STREAM", "50"))
MAX_CHAT_PER_MINUTE = int(os.getenv("MAX_CHAT_PER_MINUTE", "20"))
MAX_JOIN_PER_MINUTE = int(os.getenv("MAX_JOIN_PER_MINUTE", "10"))

# ── In-Memory State ──────────────────────────────────────────

# user_id → list of stream start timestamps (today)
_daily_streams: Dict[str, list] = defaultdict(list)

# project_id → stream start timestamp
_stream_start_times: Dict[str, float] = {}

# project_id → viewer count (tracked via WebSocket connections)
_viewer_counts: Dict[str, int] = defaultdict(int)

# (identifier, action) → list of timestamps for sliding window rate limit
_rate_windows: Dict[Tuple[str, str], list] = defaultdict(list)


def _clean_old_entries(entries: list, window_seconds: float) -> list:
    cutoff = time.time() - window_seconds
    return [t for t in entries if t > cutoff]


# ── Stream Duration ──────────────────────────────────────────

def register_stream_start(project_id: str, user_id: str) -> str | None:
    """Register a new stream. Returns error message if limit exceeded."""
    now = time.time()

    # Check daily limit
    today_start = now - (now % 86400)  # Midnight UTC
    _daily_streams[user_id] = [t for t in _daily_streams[user_id] if t > today_start]
    if len(_daily_streams[user_id]) >= MAX_STREAMS_PER_DAY:
        return f"Stream limit reached — max {MAX_STREAMS_PER_DAY} streams per day"

    _daily_streams[user_id].append(now)
    _stream_start_times[project_id] = now
    return None


def check_stream_duration(project_id: str) -> bool:
    """Returns True if stream has exceeded max duration."""
    start = _stream_start_times.get(project_id)
    if not start:
        return False
    elapsed_minutes = (time.time() - start) / 60
    return elapsed_minutes >= MAX_STREAM_DURATION_MINUTES


def get_stream_remaining_seconds(project_id: str) -> int:
    """Returns remaining seconds for a stream."""
    start = _stream_start_times.get(project_id)
    if not start:
        return MAX_STREAM_DURATION_MINUTES * 60
    elapsed = time.time() - start
    remaining = (MAX_STREAM_DURATION_MINUTES * 60) - elapsed
    return max(0, int(remaining))


def clear_stream(project_id: str):
    """Clear stream tracking on end."""
    _stream_start_times.pop(project_id, None)
    _viewer_counts.pop(project_id, None)


# ── Viewer Limits ────────────────────────────────────────────

def add_viewer(project_id: str) -> str | None:
    """Add a viewer. Returns error if capacity reached."""
    if _viewer_counts[project_id] >= MAX_VIEWERS_PER_STREAM:
        return f"Viewer capacity reached — max {MAX_VIEWERS_PER_STREAM} viewers"
    _viewer_counts[project_id] += 1
    return None


def remove_viewer(project_id: str):
    """Remove a viewer."""
    _viewer_counts[project_id] = max(0, _viewer_counts[project_id] - 1)


def get_viewer_count(project_id: str) -> int:
    return _viewer_counts[project_id]


# ── Rate Limiting ────────────────────────────────────────────

def check_rate_limit(identifier: str, action: str, max_per_minute: int) -> str | None:
    """
    Sliding window rate limit.
    Returns error message if limit exceeded, None if OK.
    """
    key = (identifier, action)
    now = time.time()
    _rate_windows[key] = _clean_old_entries(_rate_windows[key], 60.0)

    if len(_rate_windows[key]) >= max_per_minute:
        return f"Rate limit exceeded — max {max_per_minute} {action} per minute"

    _rate_windows[key].append(now)
    return None


def check_chat_rate(user_id: str) -> str | None:
    return check_rate_limit(user_id, "chat messages", MAX_CHAT_PER_MINUTE)


def check_join_rate(user_id: str) -> str | None:
    return check_rate_limit(user_id, "stream joins", MAX_JOIN_PER_MINUTE)

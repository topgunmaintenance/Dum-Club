"""
Live streaming cost protection and rate limiting.

Configurable limits — can be adjusted via env vars.
"""
import os
import time
from typing import Dict, Set, Tuple
from collections import defaultdict

# ── Configurable Limits ──────────────────────────────────────

MAX_STREAM_DURATION_MINUTES = int(os.getenv("MAX_STREAM_DURATION_MINUTES", "60"))
MAX_STREAMS_PER_DAY = int(os.getenv("MAX_STREAMS_PER_DAY", "3"))
MAX_VIEWERS_PER_STREAM = int(os.getenv("MAX_VIEWERS_PER_STREAM", "50"))
MAX_CHAT_PER_MINUTE = int(os.getenv("MAX_CHAT_PER_MINUTE", "20"))
MAX_JOIN_PER_MINUTE = int(os.getenv("MAX_JOIN_PER_MINUTE", "10"))
# Host heartbeat threshold. The frontend host posts a heartbeat
# every 5s while broadcasting; if the most recent heartbeat is
# older than this, the on-read auto-clear flips is_live=false in
# the database. 60s tolerates a brief network blip (~12 missed
# beats) while still catching genuine disconnects within a minute.
# Was 15s initially; QA flagged that as too aggressive for jittery
# mobile networks where a transient blip would end the stream.
HEARTBEAT_STALE_AFTER_SECONDS = int(os.getenv("HEARTBEAT_STALE_AFTER_SECONDS", "60"))

# ── In-Memory State ──────────────────────────────────────────

# user_id → list of stream start timestamps (today)
_daily_streams: Dict[str, list] = defaultdict(list)

# project_id → stream start timestamp
_stream_start_times: Dict[str, float] = {}

# project_id → viewer count (tracked via WebSocket connections)
_viewer_counts: Dict[str, int] = defaultdict(int)

# (identifier, action) → list of timestamps for sliding window rate limit
_rate_windows: Dict[Tuple[str, str], list] = defaultdict(list)

# project_id → last host-heartbeat timestamp. Populated by
# record_heartbeat() from the host's /api/ivs/heartbeat poll
# (every 5s while broadcasting). Used by is_heartbeat_stale() so
# read endpoints can auto-clear is_live when the host has gone
# away without calling /end-stage.
_last_heartbeat: Dict[str, float] = {}

# Project ids the on-read auto-clear has already flipped to
# is_live=false in the database, so /embed-config / /public /
# /live-status don't fire repeated idempotent UPDATEs on every
# read after the first one.
_cleared_stale_live: Set[str] = set()


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
    # Seed the heartbeat so the stream isn't immediately
    # considered stale in the 5s window before the first
    # /api/ivs/heartbeat poll lands. Also drop any prior
    # auto-clear flag so a fresh broadcast doesn't inherit
    # a previous run's "already cleared" state.
    _last_heartbeat[project_id] = now
    _cleared_stale_live.discard(project_id)
    return None


# ── Host Heartbeat ───────────────────────────────────────────

def record_heartbeat(project_id: str) -> None:
    """Update the last-heartbeat timestamp. Called from the
    POST /api/ivs/heartbeat handler on every host poll."""
    _last_heartbeat[project_id] = time.time()
    _cleared_stale_live.discard(project_id)


def is_heartbeat_stale(
    project_id: str,
    threshold_seconds: float = float(HEARTBEAT_STALE_AFTER_SECONDS),
) -> bool:
    """Return True when the most recent heartbeat is older than
    threshold_seconds.

    Resolution order:
      1. In-memory _last_heartbeat dict (fast path; 5s cadence host).
      2. DB column projects.last_heartbeat_at (survives Railway restart).
      3. No signal -> return False conservatively.

    The DB fallback closes the post-restart gap where the in-memory
    dict is empty but the project is still flagged is_live=true. Without
    it, every restart leaks orphan live streams until a host returns
    (which they often don't).
    """
    last = _last_heartbeat.get(project_id)
    if last is not None:
        return (time.time() - last) > threshold_seconds

    # Fall back to DB. Late import to avoid an import cycle; this path
    # is only exercised when in-memory tracking is missing (post-restart
    # or first hit on a project the current process never saw).
    try:
        from db.supabase import get_client
        from datetime import datetime
        res = (
            get_client()
            .table("projects")
            .select("last_heartbeat_at")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return False
        raw = res.data[0].get("last_heartbeat_at")
        if not raw:
            # NULL last_heartbeat_at means "no signal" — could be a
            # pre-migration-059 orphan, or a brand-new stream that
            # hasn't completed its first 5-second heartbeat cycle yet.
            # Refuse to call it stale from this path; the startup sweep
            # in main.py handles old orphans separately using updated_at
            # as the freshness signal. This avoids clipping a live stream
            # during the 5s window between deploy and first heartbeat
            # write.
            return False
        # Postgres returns ISO 8601 with offset; fromisoformat handles
        # the "+00:00" form. Strip any trailing 'Z' just in case.
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        db_last = datetime.fromisoformat(raw).timestamp()
        return (time.time() - db_last) > threshold_seconds
    except Exception as exc:
        print(f"[live_limits] is_heartbeat_stale DB fallback failed for {project_id}: {exc!r}")
        return False


def mark_stale_cleared(project_id: str) -> None:
    """Record that the on-read auto-clear has already flipped
    is_live=false in the DB for this project so subsequent reads
    skip the redundant UPDATE."""
    _cleared_stale_live.add(project_id)


def was_stale_cleared(project_id: str) -> bool:
    return project_id in _cleared_stale_live


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
    _last_heartbeat.pop(project_id, None)
    _cleared_stale_live.discard(project_id)


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

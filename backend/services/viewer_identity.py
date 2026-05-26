"""
Stable per-viewer identity for livestream cap + rate-limit enforcement.

PROBLEM
-------
Pre-Phase-2 every anonymous viewer of a project shared one viewer_id:

    viewer_id = user_id or f"anon-{project_uuid[:8]}"

That broke two systems at once:

  * check_join_rate() bucketed ALL anonymous viewers under one ID, so
    10 joins/min applied to the entire anonymous viewer pool combined
    (rather than 10/min per actual viewer). A single bot at saturation
    locked everyone else out OR — depending on the ordering — the bot
    sailed past the cap because the bucket reset on Railway restart.
  * viewer_session_events accumulated rows per token mint regardless
    of who minted; multi-tab and refresh both multiplied the count.
    The Phase 1 max_concurrent_viewers cap was therefore an
    overestimate of "actual unique humans who connected."

PHASE 2 FIX
-----------
derive_viewer_id() returns a stable hash over (IP, User-Agent,
project_id, optional X-Viewer-Token header) for anonymous viewers.
Authenticated viewers get their Privy DID verbatim.

DEDUP MODEL
-----------
  * Same browser, multiple tabs / refreshes for the same project ->
    same viewer_id (IP + UA + project_id are stable).
  * Same browser, different project -> different viewer_id (project_id
    is in the hash so cap counts don't cross-pollinate).
  * Different browsers behind one CGNAT IP -> different viewer_id
    (User-Agent strings differ).
  * Bot fleet sharing one IP + one UA template -> same viewer_id,
    which is the correct behavior — collapse them into one bucket
    for rate-limit and cap.

LIMITATIONS
-----------
  * Two genuine viewers using identical browsers behind the same NAT
    are conflated. Acceptable trade-off — the cap counts as one, which
    over-restricts at most by some small constant. Phase 2 frontend
    work can add a localStorage UUID via X-Viewer-Token to break ties.
  * IP comes from X-Forwarded-For (Vercel / Railway proxy); a spoofed
    header could mint a unique ID per request. Mitigation: the
    repeated-mint detector in ivs.py refuses > MAX_TOKENS_PER_VIEWER
    mints per (stream_session, viewer_id), and rate-limits on the
    derived viewer_id directly.

This module is pure (no DB, no AWS). All callers are the gate sites
in api/routes/ivs.py and any future viewer-facing endpoint that needs
identity.
"""
from __future__ import annotations

import hashlib
from typing import Optional


# Length of the trimmed sha256 used in anonymous viewer IDs. 16 hex
# chars = 64 bits of fingerprint space, plenty for our scale and short
# enough to keep stored IDs ergonomic.
_ANON_HASH_LEN = 16


def derive_viewer_id(
    *,
    user_id: Optional[str],
    project_id: str,
    forwarded_for: Optional[str] = None,
    real_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    viewer_token: Optional[str] = None,
) -> str:
    """Return a stable viewer ID for cap / rate-limit purposes.

    Authenticated path: when ``user_id`` is provided and non-empty, it
    is returned verbatim (assumed to be the caller's Privy DID).

    Anonymous path: derived from a sha256 over the available signals.
    The hash inputs in priority order are:
      1. ``viewer_token`` — set by frontend in X-Viewer-Token if it
         keeps a localStorage UUID. Most stable.
      2. ``forwarded_for`` first hop — real client IP behind a proxy.
      3. ``real_ip`` — fallback when X-Forwarded-For is absent.
      4. ``user_agent`` — UA string. Combined with the IP, breaks ties
         between distinct browsers behind one NAT.
      5. ``project_id`` — keeps the same physical viewer from sharing
         an ID across different projects (so cap counts don't conflate).

    Returns a string. Format is ``"anon-<16hex>"`` for anonymous.
    """
    if user_id and user_id.strip():
        return user_id

    # Pick the most-trustworthy IP signal available.
    ip = ""
    if forwarded_for:
        ip = forwarded_for.split(",")[0].strip()
    if not ip and real_ip:
        ip = real_ip.strip()

    fingerprint_parts = [
        viewer_token or "",
        ip,
        (user_agent or "")[:200],   # cap to avoid pathological inputs
        project_id,
    ]
    raw = "|".join(fingerprint_parts).encode("utf-8")
    h = hashlib.sha256(raw).hexdigest()[:_ANON_HASH_LEN]
    return f"anon-{h}"


def derive_viewer_id_from_request(
    *,
    user_id: Optional[str],
    project_id: str,
    request,
) -> str:
    """Convenience wrapper that pulls signals from a FastAPI Request.

    Inputs that aren't header-derivable (user_id, project_id) must be
    passed by the caller. Everything else is read from request.headers.
    """
    headers = request.headers
    return derive_viewer_id(
        user_id=user_id,
        project_id=project_id,
        forwarded_for=headers.get("x-forwarded-for"),
        real_ip=headers.get("x-real-ip"),
        user_agent=headers.get("user-agent"),
        viewer_token=headers.get("x-viewer-token"),
    )

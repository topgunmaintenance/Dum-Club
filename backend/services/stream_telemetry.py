"""
Phase 0 livestream telemetry — best-effort writes only, never block.

Three helpers, called from every stream-lifecycle site:

    on_stream_start(supabase, project_id, owner_privy_id, provider, stage_arn)
        Called from /api/ivs/create-stage and /api/projects/{id}/go-live.
        Inserts a stream_sessions row with start_at = now().

    on_viewer_token(supabase, project_id, viewer_id)
        Called from /api/ivs/viewer-token AFTER the existing caps pass.
        Inserts a viewer_session_events row keyed to the project's
        currently-active stream_sessions row.

    on_stream_end(supabase, project_id, ended_reason)
        Called from /api/ivs/end-stage, /api/projects/{id}/end-live, and
        the 3 stale-clear sites in projects.py. Sets end_at + aggregates
        on the active stream_sessions row, then upserts merchant_monthly_usage.

Design rules:

  * Every function wraps its work in a try/except. A telemetry write
    failure NEVER raises into the caller. The live path is untouched.
  * No reads from these tables on the live path (Phase 0).
  * No new caps. The helpers only INSERT/UPDATE.
  * Reversible: dropping the tables turns these into silent no-ops.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_merchant_id(supabase, owner_privy_id: Optional[str]) -> Optional[str]:
    """Look up merchants.id for an owner's privy_id. Returns None on miss
    or any error — the column is nullable, so a NULL is acceptable."""
    if not owner_privy_id:
        return None
    try:
        res = (
            supabase.table("merchants")
            .select("id")
            .eq("owner_privy_id", owner_privy_id)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0].get("id")
    except Exception as exc:  # noqa: BLE001
        # Phase 0: explicit log so a merchant-lookup outage is visible
        # in Railway, not silently hidden. The caller treats None as
        # "merchant unknown" -> records the session anyway, just without
        # the merchant_id link.
        print(f"[telemetry] _resolve_merchant_id failed for {owner_privy_id!r}: {exc!r}")
    return None


def record_replay_beat(supabase, project_id: str, source: str = "replay", seconds: int = 30) -> bool:
    """Meter recorded-video watch time (replay-viewer-hour-metering, queue 20).

    Founder decision 2026-07-06: replay/showcase hours meter against the
    SAME monthly viewer-hour budget as live hours — same included
    allowance, same overage rate, same no-double-bill netting — so we
    add into merchant_monthly_usage.viewer_seconds (the column every
    existing gate, meter, and biller reads) AND into
    replay_viewer_seconds (the split, so merchants can see live vs
    recorded on their meter; never surfaced publicly per the replay
    honesty rules).

    `seconds` is server-fixed per beat — the client only says "still
    watching", never how long, so a hostile client can't inflate or
    deflate the meter beyond the beat cadence. Best-effort: failures
    log and return False without surfacing to the viewer.
    """
    try:
        proj = (
            supabase.table("projects")
            .select("owner_id")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        if not proj.data:
            return False
        owner_uuid = proj.data[0].get("owner_id")
        if not owner_uuid:
            return False
        usr = (
            supabase.table("users")
            .select("privy_id")
            .eq("id", owner_uuid)
            .limit(1)
            .execute()
        )
        owner_privy = usr.data[0].get("privy_id") if usr.data else None
        merchant_id = _resolve_merchant_id(supabase, owner_privy)
        if not merchant_id:
            return False

        now_iso = _now_iso()
        yyyymm = now_iso[:7]
        cur = (
            supabase.table("merchant_monthly_usage")
            .select("viewer_seconds, replay_viewer_seconds")
            .eq("merchant_id", merchant_id)
            .eq("yyyymm", yyyymm)
            .limit(1)
            .execute()
        )
        if cur.data:
            row = cur.data[0]
            supabase.table("merchant_monthly_usage").update(
                {
                    "viewer_seconds": int(row.get("viewer_seconds") or 0) + seconds,
                    "replay_viewer_seconds": int(row.get("replay_viewer_seconds") or 0) + seconds,
                    "updated_at": now_iso,
                }
            ).eq("merchant_id", merchant_id).eq("yyyymm", yyyymm).execute()
        else:
            supabase.table("merchant_monthly_usage").insert(
                {
                    "merchant_id": merchant_id,
                    "yyyymm": yyyymm,
                    "stream_count": 0,
                    "viewer_seconds": seconds,
                    "replay_viewer_seconds": seconds,
                }
            ).execute()
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[telemetry] record_replay_beat failed for {project_id}: {exc!r}")
        return False


def on_stream_start(
    supabase,
    project_id: str,
    owner_privy_id: Optional[str],
    provider: str,
    stage_arn: Optional[str] = None,
) -> Optional[str]:
    """Insert a stream_sessions row at stream-start. Returns the new
    row id or None on failure. Failures are logged and swallowed."""
    try:
        merchant_id = _resolve_merchant_id(supabase, owner_privy_id)
        ins = (
            supabase.table("stream_sessions")
            .insert(
                {
                    "project_id": project_id,
                    "merchant_id": merchant_id,
                    "provider": provider,
                    "stage_arn": stage_arn,
                }
            )
            .execute()
        )
        if ins.data:
            return ins.data[0].get("id")
    except Exception as exc:  # noqa: BLE001
        print(f"[telemetry] on_stream_start failed for {project_id}: {exc!r}")
    return None


def on_viewer_token(supabase, project_id: str, viewer_id: str) -> None:
    """Insert a viewer_session_events row keyed to the project's currently-
    active stream_sessions row. No-op if no active session exists (e.g.
    telemetry write missed at stream-start)."""
    try:
        res = (
            supabase.table("stream_sessions")
            .select("id")
            .eq("project_id", project_id)
            .is_("end_at", "null")
            .order("start_at", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return
        session_id = res.data[0]["id"]
        supabase.table("viewer_session_events").insert(
            {
                "stream_session_id": session_id,
                "viewer_id": viewer_id,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001
        print(f"[telemetry] on_viewer_token failed for {project_id}: {exc!r}")


def on_stream_end(supabase, project_id: str, ended_reason: str) -> None:
    """Set end_at + aggregates on the project's active stream_sessions row,
    then upsert merchant_monthly_usage. Imperfect (Phase 0 doesn't compute
    viewer_seconds — left for a later backfill worker)."""
    try:
        res = (
            supabase.table("stream_sessions")
            .select("id, merchant_id, peak_concurrent, start_at")
            .eq("project_id", project_id)
            .is_("end_at", "null")
            .order("start_at", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return
        session = res.data[0]
        session_id = session["id"]
        merchant_id = session.get("merchant_id")
        start_at_raw = session.get("start_at")

        # Peak-concurrent — read in-memory _viewer_counts as a proxy.
        # Imperfect: that counter never decrements, so it's an upper
        # bound, not a true peak. Acceptable for Phase 0 since the goal
        # is shape-of-consumption, not exact numbers. Phase 1 should
        # use sampled snapshots written during the stream.
        peak = int(session.get("peak_concurrent") or 0)
        try:
            from services.live_limits import get_viewer_count  # late import to avoid cycles
            live_peak = int(get_viewer_count(project_id) or 0)
            if live_peak > peak:
                peak = live_peak
        except Exception:
            pass

        # Aggregate viewer-event counts. Two SELECTs (count + unique)
        # rather than one DISTINCT because the supabase-py builder is
        # easier to read this way; volume is tiny per-stream.
        total_tokens = 0
        unique_viewers = 0
        try:
            cnt_res = (
                supabase.table("viewer_session_events")
                .select("id", count="exact", head=True)
                .eq("stream_session_id", session_id)
                .execute()
            )
            total_tokens = int(getattr(cnt_res, "count", 0) or 0)
            uniq_res = (
                supabase.table("viewer_session_events")
                .select("viewer_id")
                .eq("stream_session_id", session_id)
                .limit(5000)  # safety cap; if a stream had >5k token mints we already need Phase 1
                .execute()
            )
            unique_viewers = len({r["viewer_id"] for r in (uniq_res.data or [])})
        except Exception:
            pass

        end_iso = _now_iso()
        try:
            supabase.table("stream_sessions").update(
                {
                    "end_at": end_iso,
                    "ended_reason": ended_reason,
                    "peak_concurrent": peak,
                    "total_tokens_minted": total_tokens,
                    "total_unique_viewers": unique_viewers,
                }
            ).eq("id", session_id).execute()
        except Exception as exc:  # noqa: BLE001
            print(f"[telemetry] on_stream_end session update failed for {project_id}: {exc!r}")

        # Phase 3a: estimate viewer-seconds for this session.
        # Upper-bound estimate: stream_duration × unique_viewers, i.e.
        # assume every viewer watched the whole broadcast. This
        # overestimates for streams where viewers come and go, which is
        # the conservative direction for monthly cap enforcement. AWS
        # IVS Real-Time billing is per-participant-minute; the upper-
        # bound estimate caps the platform's exposure at the merchant's
        # billed allowance rather than under-charging on a stream where
        # half the viewers left after 2 minutes.
        viewer_seconds_this_session = 0
        if start_at_raw and unique_viewers > 0:
            try:
                from datetime import datetime
                raw = start_at_raw
                if raw.endswith("Z"):
                    raw = raw[:-1] + "+00:00"
                start_dt = datetime.fromisoformat(raw)
                end_dt = datetime.fromisoformat(end_iso)
                duration_s = max(0, int((end_dt - start_dt).total_seconds()))
                viewer_seconds_this_session = duration_s * unique_viewers
            except Exception as exc:  # noqa: BLE001
                print(
                    f"[telemetry] viewer_seconds compute failed for session={session_id}: {exc!r}"
                )

        # Monthly rollup. Read-then-write is race-tolerant — two streams
        # ending in the same second on the same merchant would have one
        # increment lost, but the monthly cap enforcement re-reads on
        # every gate check, so a transient under-count self-corrects on
        # the next stream end.
        if merchant_id:
            yyyymm = end_iso[:7]  # 'YYYY-MM'
            try:
                cur = (
                    supabase.table("merchant_monthly_usage")
                    .select("stream_count, viewer_seconds")
                    .eq("merchant_id", merchant_id)
                    .eq("yyyymm", yyyymm)
                    .limit(1)
                    .execute()
                )
                if cur.data:
                    row = cur.data[0]
                    supabase.table("merchant_monthly_usage").update(
                        {
                            "stream_count": int(row.get("stream_count") or 0) + 1,
                            "viewer_seconds": int(row.get("viewer_seconds") or 0) + viewer_seconds_this_session,
                            "updated_at": end_iso,
                        }
                    ).eq("merchant_id", merchant_id).eq("yyyymm", yyyymm).execute()
                else:
                    supabase.table("merchant_monthly_usage").insert(
                        {
                            "merchant_id": merchant_id,
                            "yyyymm": yyyymm,
                            "stream_count": 1,
                            "viewer_seconds": viewer_seconds_this_session,
                        }
                    ).execute()
            except Exception as exc:  # noqa: BLE001
                print(f"[telemetry] monthly_usage upsert failed for {merchant_id} {yyyymm}: {exc!r}")
    except Exception as exc:  # noqa: BLE001
        print(f"[telemetry] on_stream_end failed for {project_id}: {exc!r}")

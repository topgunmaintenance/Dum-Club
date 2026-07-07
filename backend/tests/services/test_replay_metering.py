"""replay-viewer-hour-metering (queue 20) — unit tests.

Verifies the two contracts of record_replay_beat:
  1. Beats add into the COMBINED viewer_seconds (the column every
     gate, meter, and the overage biller read) AND the replay split.
  2. Mixed months (live seconds already present) keep a correct
     combined total — the same number the §3 no-double-bill netting
     runs on, so replay hours are billed/waived exactly like live.
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from services.stream_telemetry import record_replay_beat  # noqa: E402


class _FakeQuery:
    def __init__(self, db, table):
        self._db = db
        self._table = table
        self._filters = {}
        self._action = "select"
        self._payload = None

    def select(self, *_a, **_k):
        self._action = "select"
        return self

    def insert(self, payload):
        self._action = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._action = "update"
        self._payload = payload
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def limit(self, _n):
        return self

    def execute(self):
        rows = self._db.tables.get(self._table, [])
        if self._action == "select":
            data = [
                r for r in rows
                if all(r.get(c) == v for c, v in self._filters.items())
            ]
            return type("R", (), {"data": data})()
        if self._action == "insert":
            rows.append(dict(self._payload))
            self._db.tables[self._table] = rows
            return type("R", (), {"data": [dict(self._payload)]})()
        if self._action == "update":
            for r in rows:
                if all(r.get(c) == v for c, v in self._filters.items()):
                    r.update(self._payload)
            return type("R", (), {"data": rows})()
        return type("R", (), {"data": []})()


class _FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _FakeQuery(self, name)


def _base_tables(usage_rows=None):
    return {
        "projects": [{"id": "proj-1", "owner_id": "user-uuid-1", "account_id": None}],
        "users": [{"id": "user-uuid-1", "privy_id": "privy-1"}],
        "merchants": [{"id": "merch-1", "owner_privy_id": "privy-1"}],
        "merchant_monthly_usage": usage_rows or [],
    }


def _multi_login_tables():
    """The real-world shape found live 2026-07-07: the project's owner_id
    points at a DIFFERENT users row than the merchant's owner_privy_id
    (founders sign in several ways), but both share account_id."""
    return {
        "projects": [{"id": "proj-1", "owner_id": "other-user-uuid", "account_id": "acct-1"}],
        "users": [
            {"id": "other-user-uuid", "privy_id": "privy-OTHER"},
            {"id": "main-user-uuid", "privy_id": "privy-MAIN"},
        ],
        "merchants": [{"id": "merch-1", "owner_privy_id": "privy-MAIN", "account_id": "acct-1"}],
        "merchant_monthly_usage": [],
    }


class ReplayMeteringTests(unittest.TestCase):
    def test_first_beat_creates_month_row_with_both_columns(self):
        sb = _FakeSupabase(_base_tables())
        ok = record_replay_beat(sb, "proj-1", source="replay", seconds=30)
        self.assertTrue(ok)
        rows = sb.tables["merchant_monthly_usage"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["viewer_seconds"], 30)
        self.assertEqual(rows[0]["replay_viewer_seconds"], 30)
        self.assertEqual(rows[0]["merchant_id"], "merch-1")

    def test_beats_accumulate_into_combined_total_with_live_hours(self):
        # Month already has 7200s (2h) of LIVE watch time.
        from datetime import datetime, timezone
        yyyymm = datetime.now(timezone.utc).isoformat()[:7]
        sb = _FakeSupabase(_base_tables([
            {
                "merchant_id": "merch-1",
                "yyyymm": yyyymm,
                "stream_count": 3,
                "viewer_seconds": 7200,
                "replay_viewer_seconds": 0,
            }
        ]))
        for _ in range(4):  # 4 beats = 120s of replay watching
            self.assertTrue(record_replay_beat(sb, "proj-1", source="showcase", seconds=30))
        row = sb.tables["merchant_monthly_usage"][0]
        # Combined total = live + replay: this is the single number the
        # usage meter, the hard-block gate, and the no-double-bill
        # netting (net_overage = max(0, overage - sales_fee)) all read,
        # so replay hours bill and waive exactly like live hours.
        self.assertEqual(row["viewer_seconds"], 7200 + 120)
        self.assertEqual(row["replay_viewer_seconds"], 120)
        # Live share stays derivable for the meter split.
        self.assertEqual(row["viewer_seconds"] - row["replay_viewer_seconds"], 7200)

    def test_multi_login_owner_resolves_via_account_bridge(self):
        # Project owned by login identity A, merchant registered under
        # login identity B, linked by account_id — the beat must still
        # credit the merchant (fix/replay-beat-account-bridge).
        sb = _FakeSupabase(_multi_login_tables())
        ok = record_replay_beat(sb, "proj-1", source="replay", seconds=30)
        self.assertTrue(ok)
        rows = sb.tables["merchant_monthly_usage"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["merchant_id"], "merch-1")
        self.assertEqual(rows[0]["viewer_seconds"], 30)

    def test_unknown_project_is_a_safe_noop(self):
        sb = _FakeSupabase(_base_tables())
        ok = record_replay_beat(sb, "no-such-project", source="replay", seconds=30)
        self.assertFalse(ok)
        self.assertEqual(sb.tables["merchant_monthly_usage"], [])


if __name__ == "__main__":
    unittest.main()

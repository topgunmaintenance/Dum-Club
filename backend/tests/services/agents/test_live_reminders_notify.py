"""
Unit tests for services.agents.live_reminders.notify_project_live_now —
the instant-go-live notification path.

Stdlib unittest only. Pins the contract that matters:

  1. All unsent subscribers for the project are emailed on go-live.
  2. The atomic sent_at claim is used (rows get stamped), so a re-run
     (or the scheduled cron) cannot double-send.
  3. Already-sent subscribers are never re-notified.
  4. A send failure still stamps sent_at (at-most-once delivery), and
     a go-live never raises because of email trouble.

Run from repo root:
    cd backend && python -m unittest tests.services.agents.test_live_reminders_notify
"""

from __future__ import annotations

import os
import sys
import types
import unittest
from types import SimpleNamespace

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

# live_reminders imports db.supabase (needs the supabase pkg, absent in CI)
# and services.email at module load. Stub both in sys.modules so the module
# imports fully offline; the tests inject their own fake client and
# monkeypatch send_live_reminder anyway.
if "db.supabase" not in sys.modules:
    _fake_db = types.ModuleType("db.supabase")
    _fake_db.get_client = lambda: None
    sys.modules["db.supabase"] = _fake_db
if "services.email" not in sys.modules:
    _fake_email = types.ModuleType("services.email")
    _fake_email.send_live_reminder = lambda **kw: True
    _fake_email.EMAIL_ENABLED = False
    sys.modules["services.email"] = _fake_email

import services.agents.live_reminders as lr  # noqa: E402


# ── Minimal fake Supabase supporting the three chains the helper uses ──
class _Q:
    def __init__(self, db, table):
        self._db = db
        self._table = table
        self._op = "select"
        self._filters = []
        self._payload = None

    def select(self, *_a, **_kw):
        self._op = "select"
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def is_(self, col, val):
        self._filters.append((col, f"is:{val}"))
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        return self._db._run(self)


class FakeDB:
    def __init__(self, reminders, project):
        # reminders: list of {id, customer_email, sent_at}
        self.reminders = {r["id"]: dict(r) for r in reminders}
        self.project = project
        self.claimed_ids = []

    def table(self, name):
        return _Q(self, name)

    def _run(self, q):
        if q._table == "live_reminders" and q._op == "select":
            rows = [
                {"id": r["id"], "customer_email": r["customer_email"]}
                for r in self.reminders.values()
                if r["sent_at"] is None
            ]
            return SimpleNamespace(data=rows)
        if q._table == "projects" and q._op == "select":
            return SimpleNamespace(data=[self.project] if self.project else [])
        if q._table == "live_reminders" and q._op == "update":
            rid = next((v for (c, v) in q._filters if c == "id"), None)
            row = self.reminders.get(rid)
            if row and row["sent_at"] is None:
                row["sent_at"] = q._payload["sent_at"]
                self.claimed_ids.append(rid)
                return SimpleNamespace(data=[{"id": rid}])
            return SimpleNamespace(data=[])  # lost the claim race
        return SimpleNamespace(data=[])


PROJECT = {"id": "proj-1", "slug": "website-designer", "name": "Website designer", "title": "Website designer"}


class TestNotifyProjectLiveNow(unittest.TestCase):
    def setUp(self):
        self._sent = []
        self._orig = lr.send_live_reminder
        lr.send_live_reminder = lambda **kw: (self._sent.append(kw) or True)

    def tearDown(self):
        lr.send_live_reminder = self._orig

    def test_emails_all_unsent_subscribers_and_stamps(self):
        db = FakeDB(
            reminders=[
                {"id": "r1", "customer_email": "a@x.com", "sent_at": None},
                {"id": "r2", "customer_email": "b@x.com", "sent_at": None},
            ],
            project=PROJECT,
        )
        counts = lr.notify_project_live_now("proj-1", supabase=db)
        self.assertEqual(counts["scanned"], 2)
        self.assertEqual(counts["claimed"], 2)
        self.assertEqual(counts["sent"], 2)
        # Both rows stamped → cron / re-run can't resend.
        self.assertTrue(all(r["sent_at"] is not None for r in db.reminders.values()))
        self.assertEqual(len(self._sent), 2)
        self.assertEqual(self._sent[0]["business_name"], "Website designer")

    def test_idempotent_second_run_sends_nothing(self):
        db = FakeDB(
            reminders=[{"id": "r1", "customer_email": "a@x.com", "sent_at": None}],
            project=PROJECT,
        )
        lr.notify_project_live_now("proj-1", supabase=db)
        self._sent.clear()
        again = lr.notify_project_live_now("proj-1", supabase=db)
        self.assertEqual(again["scanned"], 0)
        self.assertEqual(again["sent"], 0)
        self.assertEqual(len(self._sent), 0)

    def test_already_sent_subscriber_is_skipped(self):
        db = FakeDB(
            reminders=[
                {"id": "r1", "customer_email": "a@x.com", "sent_at": "2026-06-01T00:00:00+00:00"},
                {"id": "r2", "customer_email": "b@x.com", "sent_at": None},
            ],
            project=PROJECT,
        )
        counts = lr.notify_project_live_now("proj-1", supabase=db)
        self.assertEqual(counts["scanned"], 1)  # only the unsent one
        self.assertEqual(counts["sent"], 1)
        self.assertEqual(self._sent[0]["customer_email"], "b@x.com")

    def test_no_subscribers_is_noop(self):
        db = FakeDB(reminders=[], project=PROJECT)
        counts = lr.notify_project_live_now("proj-1", supabase=db)
        self.assertEqual(counts, {"scanned": 0, "claimed": 0, "sent": 0, "errored": 0})
        self.assertEqual(len(self._sent), 0)

    def test_send_failure_still_stamps_and_does_not_raise(self):
        lr.send_live_reminder = lambda **kw: False  # simulate Resend down
        db = FakeDB(
            reminders=[{"id": "r1", "customer_email": "a@x.com", "sent_at": None}],
            project=PROJECT,
        )
        counts = lr.notify_project_live_now("proj-1", supabase=db)
        self.assertEqual(counts["claimed"], 1)
        self.assertEqual(counts["sent"], 0)  # send returned False
        # At-most-once: sent_at is stamped even though the send failed.
        self.assertIsNotNone(db.reminders["r1"]["sent_at"])


if __name__ == "__main__":
    unittest.main()

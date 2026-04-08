"""
Tests for LocalDiscoveryAgent.

Uses stdlib unittest + unittest.mock only — no pytest, no new deps.
Run from backend/ dir:

    python -m unittest backend.tests.services.agents.test_local_discovery

or from repo root:

    cd backend && python -m unittest tests.services.agents.test_local_discovery

The agent is designed to take its Supabase client and places provider as
constructor arguments, so every test here runs fully offline.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

# Allow `python -m unittest` from repo root to find the `backend` modules
# without editing PYTHONPATH externally.
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from services.agents.local_discovery import LocalDiscoveryAgent  # noqa: E402


# ── Fakes ───────────────────────────────────────────────────────────────


class _FakeQuery:
    """Chainable fake that mimics the supabase-py builder API."""

    def __init__(self, data):
        self._data = data

    def select(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def upsert(self, row, on_conflict=None):
        # Simulate a successful upsert that returns a DB id.
        merged = dict(row)
        merged.setdefault("id", f"db-{row.get('external_place_id', 'x')}")
        return _FakeQuery([merged])

    def execute(self):
        return SimpleNamespace(data=self._data)


class _FakeSupabase:
    """Minimal Supabase stub. `projects` returns fixtures, `external_businesses` echoes upserts."""

    def __init__(self, projects):
        self._projects = projects

    def table(self, name: str):
        if name == "projects":
            return _FakeQuery(self._projects)
        if name == "external_businesses":
            return _FakeQuery([])  # upsert path creates its own _FakeQuery
        return _FakeQuery([])


class _FakePlace:
    def __init__(self, name, category="", rating=None, reviews=0, place_id="p1"):
        self.external_source = "google_places"
        self.external_place_id = place_id
        self.name = name
        self.address = "123 Main St"
        self.city = "Newark"
        self.category = category
        self.rating = rating
        self.review_count = reviews
        self.phone = ""
        self.website = ""

    def to_dict(self):
        return {
            "external_source": self.external_source,
            "external_place_id": self.external_place_id,
            "name": self.name,
            "address": self.address,
            "city": self.city,
            "category": self.category,
            "rating": self.rating,
            "review_count": self.review_count,
            "phone": self.phone,
            "website": self.website,
        }


def _fake_places_provider(places_to_return):
    async def _provider(query, city, latitude=None, longitude=None, limit=5):
        return list(places_to_return)
    return _provider


async def _empty_provider(query, city, latitude=None, longitude=None, limit=5):
    return []


# ── Tests ───────────────────────────────────────────────────────────────


class LocalDiscoveryAgentTests(unittest.TestCase):

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)

    # — Query hygiene —

    def test_empty_query_returns_empty_status(self):
        agent = LocalDiscoveryAgent(
            supabase=_FakeSupabase([]),
            places_provider=_empty_provider,
        )
        result = self._run(agent.run({"query": "   "}))
        self.assertEqual(result.status, "empty")
        self.assertEqual(result.reason, "empty_query")
        self.assertEqual(result.data.get("reason"), "empty_query")

    def test_query_with_only_stopwords_returns_empty(self):
        agent = LocalDiscoveryAgent(
            supabase=_FakeSupabase([]),
            places_provider=_empty_provider,
        )
        # "a" gets stripped; "me" is <= 2 chars after normalisation
        result = self._run(agent.run({"query": "a me"}))
        self.assertEqual(result.status, "empty")
        self.assertEqual(result.reason, "no_valid_words")
        self.assertEqual(result.data.get("on_dum_club"), [])
        self.assertEqual(result.data.get("nearby_off_platform"), [])

    # — DUM Club side —

    def test_returns_dum_club_match_with_packet_fields(self):
        projects = [{
            "id": "proj1",
            "title": "Newark Pizza Co",
            "description": "Best pizza in Newark",
            "template_type": "food",
            "offers": [
                {"title": "Large pizza", "price_usd": 20.0, "quantity_sold": 3, "is_active": True},
                {"title": "Small pizza", "price_usd": 10.0, "quantity_sold": 0, "is_active": True},
            ],
        }]
        agent = LocalDiscoveryAgent(
            supabase=_FakeSupabase(projects),
            places_provider=_empty_provider,
        )
        result = self._run(agent.run({"query": "pizza", "city": "Newark"}))
        self.assertEqual(result.status, "ok")
        dum = result.data["on_dum_club"]
        self.assertEqual(len(dum), 1)
        packet = dum[0]
        self.assertTrue(packet["on_dum_club"])
        self.assertEqual(packet["source"], "dum_club")
        self.assertFalse(packet["claimable"])
        self.assertGreater(packet["confidence"], 0.0)
        self.assertIn("pizza", packet["reason_for_match"])
        self.assertEqual(packet["project"]["id"], "proj1")
        self.assertIsNotNone(packet["offer"])

    def test_projects_with_no_active_offers_score_zero(self):
        projects = [{
            "id": "proj1",
            "title": "Pizza Place",
            "description": "pizza pizza pizza",
            "offers": [
                {"title": "Old pizza", "price_usd": 10.0, "is_active": False},
            ],
        }]
        agent = LocalDiscoveryAgent(
            supabase=_FakeSupabase(projects),
            places_provider=_empty_provider,
        )
        result = self._run(agent.run({"query": "pizza"}))
        self.assertEqual(result.data["on_dum_club"], [])

    # — External side —

    def test_local_intent_triggers_external_search_even_with_dum_match(self):
        """
        Core product-direction change: the agent always returns external
        results when local intent is present, even when a strong DUM Club
        match exists. This was gated in the legacy code path.
        """
        projects = [{
            "id": "proj1",
            "title": "Pizza On The Club",
            "description": "best pizza",
            "offers": [
                {"title": "Large", "price_usd": 20.0, "quantity_sold": 5, "is_active": True},
            ],
        }]
        places = [
            _FakePlace("Tony's Pizza", category="restaurant", rating=4.8, reviews=320, place_id="a"),
            _FakePlace("Slice Bar", category="restaurant", rating=4.2, reviews=50, place_id="b"),
        ]
        agent = LocalDiscoveryAgent(
            supabase=_FakeSupabase(projects),
            places_provider=_fake_places_provider(places),
        )
        result = self._run(agent.run({"query": "pizza near me"}))
        self.assertEqual(result.status, "ok")
        self.assertTrue(result.data["local_intent"])
        self.assertGreaterEqual(len(result.data["on_dum_club"]), 1)
        self.assertEqual(len(result.data["nearby_off_platform"]), 2)

    def test_external_packet_shape_and_claimable_flag(self):
        places = [_FakePlace("Tony's Pizza", category="restaurant", rating=4.7, reviews=150)]
        agent = LocalDiscoveryAgent(
            supabase=_FakeSupabase([]),
            places_provider=_fake_places_provider(places),
        )
        result = self._run(agent.run({"query": "pizza near me"}))
        ext = result.data["nearby_off_platform"]
        self.assertEqual(len(ext), 1)
        p = ext[0]
        self.assertFalse(p["on_dum_club"])
        self.assertTrue(p["claimable"])
        self.assertEqual(p["source"], "google_places")
        self.assertGreater(p["confidence"], 0.0)
        # Confidence is heuristic, bounded 0..1
        self.assertLessEqual(p["confidence"], 1.0)
        self.assertIn("reason_for_match", p)
        # Upsert path assigns a DB id via our fake
        self.assertTrue(p["external_business_id"].startswith("db-"))

    def test_no_local_intent_skips_external_provider(self):
        """When no local intent, the provider must not be called."""
        call_counter = {"n": 0}

        async def _tracking_provider(query, city, latitude=None, longitude=None, limit=5):
            call_counter["n"] += 1
            return []

        projects = [{
            "id": "proj1",
            "title": "Launching a dev tool",
            "description": "developer utility",
            "offers": [{"title": "pro plan", "price_usd": 5.0, "is_active": True}],
        }]
        agent = LocalDiscoveryAgent(
            supabase=_FakeSupabase(projects),
            places_provider=_tracking_provider,
        )
        result = self._run(agent.run({"query": "developer tool"}))
        self.assertEqual(call_counter["n"], 0)
        self.assertEqual(result.data["local_intent"], False)

    # — Confidence heuristic —

    def test_external_confidence_scales_with_rating_and_reviews(self):
        high = LocalDiscoveryAgent._external_confidence({"rating": 5.0, "review_count": 1000})
        mid = LocalDiscoveryAgent._external_confidence({"rating": 4.0, "review_count": 50})
        low = LocalDiscoveryAgent._external_confidence({"rating": 2.0, "review_count": 1})
        zero = LocalDiscoveryAgent._external_confidence({})
        self.assertGreater(high, mid)
        self.assertGreater(mid, low)
        self.assertGreater(low, zero)
        self.assertEqual(zero, 0.0)
        self.assertLessEqual(high, 1.0)

    # — Logs —

    def test_logs_are_drained_into_result(self):
        places = [_FakePlace("Tony's Pizza", rating=4.5, reviews=10)]
        agent = LocalDiscoveryAgent(
            supabase=_FakeSupabase([]),
            places_provider=_fake_places_provider(places),
        )
        result = self._run(agent.run({"query": "pizza near me"}))
        self.assertTrue(any("local_discovery" in line for line in result.logs))


if __name__ == "__main__":
    unittest.main()

"""
Tests for the showcase/replay auth hardening (2026-09-01).

Root cause being locked in: the showcase & replay mutation endpoints
(replay-toggle, showcase-upload-url, showcase-uploaded,
showcase-activate) identified the caller by a bare `user_id` request
header. That value is attacker-controlled, and the matching privy_id is
discoverable from public project payloads — so an unauthenticated caller
could mint a presigned upload URL and put their own video on ANY
storefront, or flip which video plays. These endpoints now take identity
ONLY from a verified Privy Bearer token (auth.privy.get_current_user).

Run from repo root:

    cd backend && python -m unittest tests.api.test_showcase_auth
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
import unittest
from unittest import mock

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

os.environ.setdefault("SUPABASE_URL", "http://localhost-not-used")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_pretend_secret")

from fastapi import HTTPException  # noqa: E402
from fastapi.params import Depends as DependsParam  # noqa: E402

from api.routes import ivs  # noqa: E402
from auth.privy import get_current_user  # noqa: E402

OWNER_DID = "did:privy:owner123"
ATTACKER_DID = "did:privy:attacker456"
PROJECT_UUID = "11111111-2222-3333-4444-555555555555"

SECURED_ROUTES = (
    ivs.api_replay_toggle,
    ivs.api_showcase_upload_url,
    ivs.api_showcase_uploaded,
    ivs.api_showcase_activate,
)


class _FakeResult:
    def __init__(self, rows):
        self.data = rows


class _FakeTable:
    """Minimal chainable stand-in for a supabase table query."""

    def __init__(self, rows_by_call):
        self._rows = rows_by_call

    def select(self, *_a, **_k):
        return self

    def update(self, *_a, **_k):
        return self

    def upsert(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return _FakeResult(self._rows)


class _FakeSupabase:
    def __init__(self, project_rows):
        self._project_rows = project_rows

    def table(self, name):
        if name == "projects":
            return _FakeTable(self._project_rows)
        # live_replays and friends: chainable no-op returning no rows
        return _FakeTable([])


def _project_row(privy_id=OWNER_DID):
    return {
        "id": PROJECT_UUID,
        "owner_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "privy_id": privy_id,
        "is_live": False,
        "ivs_stage_arn": None,
    }


def _patch_supabase(project_rows):
    """Patch every get_client the code paths touch, plus the DID→uuid
    resolver (its own supabase lookups are irrelevant here)."""
    patches = [
        mock.patch.object(ivs, "get_client", return_value=_FakeSupabase(project_rows)),
        mock.patch("api.routes.projects.get_client", return_value=_FakeSupabase(project_rows)),
        mock.patch("api.routes.projects._resolve_owner_uuid", return_value=None),
        mock.patch(
            "api.routes.projects.resolve_project_uuid",
            side_effect=lambda _sb, pid: PROJECT_UUID if project_rows else None,
        ),
    ]
    return patches


class RoutesRequireVerifiedTokenTests(unittest.TestCase):
    """The structural guarantee: identity can only enter through the
    verified-token dependency, never through a request header."""

    def test_no_secured_route_reads_a_user_id_header(self):
        for fn in SECURED_ROUTES:
            sig = inspect.signature(fn)
            self.assertNotIn(
                "user_id",
                sig.parameters,
                f"{fn.__name__} still accepts a spoofable user_id header",
            )

    def test_every_secured_route_depends_on_get_current_user(self):
        for fn in SECURED_ROUTES:
            sig = inspect.signature(fn)
            deps = [
                p.default.dependency
                for p in sig.parameters.values()
                if isinstance(p.default, DependsParam)
            ]
            self.assertIn(
                get_current_user,
                deps,
                f"{fn.__name__} does not require a verified Privy token",
            )


class DidFromClaimsTests(unittest.TestCase):
    def test_missing_sub_is_401(self):
        for claims in ({}, None, {"aud": "app"}):
            with self.assertRaises(HTTPException) as ctx:
                ivs._did_from_claims(claims)
            self.assertEqual(ctx.exception.status_code, 401)

    def test_valid_claims_return_did(self):
        self.assertEqual(ivs._did_from_claims({"sub": OWNER_DID}), OWNER_DID)


class OwnerEnforcementTests(unittest.TestCase):
    """A VALID token for the wrong user must still be a 403 — token
    verification alone is not ownership."""

    def _call(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro)

    def test_attacker_with_valid_token_cannot_activate(self):
        patches = _patch_supabase([_project_row(privy_id=OWNER_DID)])
        for p in patches:
            p.start()
        try:
            body = ivs.ShowcaseActivateRequest(project_id=PROJECT_UUID, source="upload")
            with self.assertRaises(HTTPException) as ctx:
                self._call(ivs.api_showcase_activate(body, claims={"sub": ATTACKER_DID}))
            self.assertEqual(ctx.exception.status_code, 403)
        finally:
            for p in patches:
                p.stop()

    def test_owner_with_valid_token_can_activate(self):
        patches = _patch_supabase([_project_row(privy_id=OWNER_DID)])
        for p in patches:
            p.start()
        try:
            body = ivs.ShowcaseActivateRequest(project_id=PROJECT_UUID, source="upload")
            res = self._call(ivs.api_showcase_activate(body, claims={"sub": OWNER_DID}))
            self.assertEqual(res.get("status"), "success")
            self.assertEqual(res.get("active_source"), "upload")
        finally:
            for p in patches:
                p.stop()

    def test_attacker_cannot_mint_upload_url(self):
        patches = _patch_supabase([_project_row(privy_id=OWNER_DID)])
        for p in patches:
            p.start()
        try:
            body = ivs.ShowcaseUploadUrlRequest(
                project_id=PROJECT_UUID, content_type="video/mp4"
            )
            with self.assertRaises(HTTPException) as ctx:
                self._call(ivs.api_showcase_upload_url(body, claims={"sub": ATTACKER_DID}))
            self.assertEqual(ctx.exception.status_code, 403)
        finally:
            for p in patches:
                p.stop()

    def test_unverified_no_claims_is_401_not_owner_lookup(self):
        """Empty claims (no verified token) must 401 BEFORE any project
        lookup — the pre-fix behavior defaulted identity to 'demo-user'
        and went straight to the owner check."""
        body = ivs.ShowcaseActivateRequest(project_id=PROJECT_UUID, source="upload")
        with self.assertRaises(HTTPException) as ctx:
            self._call(ivs.api_showcase_activate(body, claims={}))
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()

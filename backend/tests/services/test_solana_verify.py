"""
Tests for services.solana_verify.

Stdlib unittest only — same harness the existing
tests/services/agents/* tests use. Run from repo root:

    cd backend && python -m unittest tests.services.test_solana_verify

Covers:
  - HMAC quote sign + verify roundtrip
  - tampered quote rejected
  - expired quote rejected
  - quote bound to offer/buyer (mismatch rejected)
  - missing HMAC secret hard-fails (no silent forgery)
  - on-chain verifier: happy path
  - on-chain verifier: tx not found
  - on-chain verifier: amount mismatch (treasury delta too small)
  - on-chain verifier: sender mismatch
"""

from __future__ import annotations

import os
import sys
import time
import unittest
from types import SimpleNamespace
from unittest import mock


_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

# Set the HMAC secret BEFORE importing the module so that
# _quote_secret() works on the happy-path tests.
os.environ.setdefault("SOL_CHECKOUT_QUOTE_HMAC_SECRET", "test-secret-do-not-use-in-prod")

from services import solana_verify  # noqa: E402


# ── Quote token roundtrip ───────────────────────────────────────


class QuoteTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = 1_700_000_000  # fixed reference time
        self.kwargs = dict(
            offer_id="offer-abc",
            buyer_privy_id="did:privy:user-1",
            lamports=12_345_678,
            sol_amount=0.012345678,
            usd_amount=1.85,
            treasury="TREASURY_PUBKEY_BASE58",
        )

    def test_roundtrip_happy_path(self) -> None:
        token, exp = solana_verify.make_quote_token(now_ts=self.now, **self.kwargs)
        self.assertGreater(exp, self.now)

        payload = solana_verify.verify_quote_token(
            token,
            expected_offer_id=self.kwargs["offer_id"],
            expected_buyer_privy_id=self.kwargs["buyer_privy_id"],
            now_ts=self.now + 10,
        )
        self.assertEqual(payload["offer_id"], "offer-abc")
        self.assertEqual(payload["lamports"], 12_345_678)
        self.assertEqual(payload["treasury"], "TREASURY_PUBKEY_BASE58")

    def test_tampered_payload_rejected(self) -> None:
        token, _ = solana_verify.make_quote_token(now_ts=self.now, **self.kwargs)
        body_b64, sig_b64 = token.split(".")
        # Flip a character in the body — sig won't match.
        flipped = ("A" if body_b64[0] != "A" else "B") + body_b64[1:]
        bad = f"{flipped}.{sig_b64}"
        with self.assertRaises(solana_verify.QuoteVerifyError) as ctx:
            solana_verify.verify_quote_token(bad, now_ts=self.now + 10)
        self.assertIn("signature", str(ctx.exception).lower())

    def test_tampered_signature_rejected(self) -> None:
        token, _ = solana_verify.make_quote_token(now_ts=self.now, **self.kwargs)
        body_b64, sig_b64 = token.split(".")
        flipped = ("A" if sig_b64[0] != "A" else "B") + sig_b64[1:]
        bad = f"{body_b64}.{flipped}"
        with self.assertRaises(solana_verify.QuoteVerifyError):
            solana_verify.verify_quote_token(bad, now_ts=self.now + 10)

    def test_expired_quote_rejected(self) -> None:
        token, exp = solana_verify.make_quote_token(now_ts=self.now, **self.kwargs)
        with self.assertRaises(solana_verify.QuoteVerifyError) as ctx:
            solana_verify.verify_quote_token(token, now_ts=exp + 1)
        self.assertIn("expired", str(ctx.exception).lower())

    def test_offer_mismatch_rejected(self) -> None:
        token, _ = solana_verify.make_quote_token(now_ts=self.now, **self.kwargs)
        with self.assertRaises(solana_verify.QuoteVerifyError) as ctx:
            solana_verify.verify_quote_token(
                token,
                expected_offer_id="DIFFERENT_OFFER",
                now_ts=self.now + 10,
            )
        self.assertIn("offer", str(ctx.exception).lower())

    def test_buyer_mismatch_rejected(self) -> None:
        token, _ = solana_verify.make_quote_token(now_ts=self.now, **self.kwargs)
        with self.assertRaises(solana_verify.QuoteVerifyError) as ctx:
            solana_verify.verify_quote_token(
                token,
                expected_buyer_privy_id="did:privy:other-user",
                now_ts=self.now + 10,
            )
        self.assertIn("buyer", str(ctx.exception).lower())

    def test_missing_hmac_secret_hard_fails(self) -> None:
        """If the secret is unset, both sign and verify must refuse —
        otherwise an attacker who clears the env can forge tokens.

        The module captures the secret at import time, so we patch
        the module-level constant directly."""
        with mock.patch.object(solana_verify, "_QUOTE_HMAC_SECRET", ""):
            with self.assertRaises(solana_verify.QuoteVerifyError):
                solana_verify.make_quote_token(now_ts=self.now, **self.kwargs)


# ── On-chain verifier (RPC mocked) ──────────────────────────────


def _rpc_response(result):
    """Build the requests.post().json() shape Solana RPC returns."""
    fake = SimpleNamespace()
    fake.json = lambda: {"jsonrpc": "2.0", "id": 1, "result": result}
    fake.raise_for_status = lambda: None
    return fake


def _tx_with_balance_deltas(account_keys, pre, post, err=None):
    """Helper: shape that getTransaction returns."""
    return {
        "meta": {
            "err": err,
            "preBalances": pre,
            "postBalances": post,
        },
        "transaction": {"message": {"accountKeys": account_keys}},
    }


class VerifySolTransferTests(unittest.TestCase):
    TREASURY = "TREASURY_PUBKEY_BASE58_LONG_ENOUGH"
    SENDER = "SENDER_PUBKEY_BASE58_LONG_ENOUGH_TOO"

    def setUp(self) -> None:
        self.sig = "FAKE_SIG_LONG_ENOUGH_FOR_VALIDATION_AAAA"
        self.expected_lamports = 1_000_000  # 0.001 SOL

    def _patch_post(self, json_result):
        return mock.patch.object(
            solana_verify.http_requests,
            "post",
            return_value=_rpc_response(json_result),
        )

    def test_happy_path_with_sender_check(self) -> None:
        # Sender pre=10M, post=10M-1M-fee → delta = -1.005M (sent)
        # Treasury pre=0, post=1M → delta = +1M (received)
        result = _tx_with_balance_deltas(
            account_keys=[self.SENDER, self.TREASURY],
            pre=[10_000_000, 0],
            post=[8_995_000, 1_000_000],  # sender lost 1.005M; treasury got 1M
        )
        with self._patch_post(result):
            ok = solana_verify.verify_sol_transfer(
                self.sig,
                self.expected_lamports,
                self.TREASURY,
                expected_sender=self.SENDER,
            )
        self.assertIs(ok, True)

    def test_happy_path_without_sender_check(self) -> None:
        result = _tx_with_balance_deltas(
            account_keys=[self.SENDER, self.TREASURY],
            pre=[10_000_000, 0],
            post=[8_995_000, 1_000_000],
        )
        with self._patch_post(result):
            ok = solana_verify.verify_sol_transfer(
                self.sig, self.expected_lamports, self.TREASURY
            )
        self.assertIs(ok, True)

    def test_tx_not_found(self) -> None:
        with self._patch_post(None):
            ret = solana_verify.verify_sol_transfer(
                self.sig, self.expected_lamports, self.TREASURY
            )
        self.assertIsInstance(ret, str)
        self.assertIn("not found", ret.lower())

    def test_tx_failed_on_chain(self) -> None:
        result = _tx_with_balance_deltas(
            account_keys=[self.SENDER, self.TREASURY],
            pre=[10_000_000, 0],
            post=[10_000_000, 0],
            err={"InstructionError": [0, "Custom"]},
        )
        with self._patch_post(result):
            ret = solana_verify.verify_sol_transfer(
                self.sig, self.expected_lamports, self.TREASURY
            )
        self.assertIsInstance(ret, str)
        self.assertIn("failed on-chain", ret.lower())

    def test_amount_too_small(self) -> None:
        # Treasury only got 0.5M, expected 1M → delta below 95% slack.
        result = _tx_with_balance_deltas(
            account_keys=[self.SENDER, self.TREASURY],
            pre=[10_000_000, 0],
            post=[9_495_000, 500_000],
        )
        with self._patch_post(result):
            ret = solana_verify.verify_sol_transfer(
                self.sig, self.expected_lamports, self.TREASURY
            )
        self.assertIsInstance(ret, str)
        self.assertIn("treasury", ret.lower())

    def test_treasury_not_in_account_keys(self) -> None:
        result = _tx_with_balance_deltas(
            account_keys=[self.SENDER, "SOMEONE_ELSE_PUBKEY_LONG_ENOUGH_AB"],
            pre=[10_000_000, 0],
            post=[8_995_000, 1_000_000],
        )
        with self._patch_post(result):
            ret = solana_verify.verify_sol_transfer(
                self.sig, self.expected_lamports, self.TREASURY
            )
        self.assertIsInstance(ret, str)
        self.assertIn("treasury", ret.lower())

    def test_sender_mismatch_when_sender_required(self) -> None:
        # Treasury got the SOL, but the sending account is different
        # from the wallet the buyer claimed.
        result = _tx_with_balance_deltas(
            account_keys=["DIFFERENT_SENDER_PUBKEY_LONG_ENOUGH", self.TREASURY],
            pre=[10_000_000, 0],
            post=[8_995_000, 1_000_000],
        )
        with self._patch_post(result):
            ret = solana_verify.verify_sol_transfer(
                self.sig,
                self.expected_lamports,
                self.TREASURY,
                expected_sender=self.SENDER,
            )
        self.assertIsInstance(ret, str)
        self.assertIn("wallet", ret.lower())

    def test_object_account_keys_normalized(self) -> None:
        """When the RPC returns account keys as objects (parsed
        encoding), the verifier must read .pubkey, not the raw
        dict."""
        result = _tx_with_balance_deltas(
            account_keys=[
                {"pubkey": self.SENDER, "signer": True, "writable": True},
                {"pubkey": self.TREASURY, "signer": False, "writable": True},
            ],
            pre=[10_000_000, 0],
            post=[8_995_000, 1_000_000],
        )
        with self._patch_post(result):
            ok = solana_verify.verify_sol_transfer(
                self.sig, self.expected_lamports, self.TREASURY
            )
        self.assertIs(ok, True)

    def test_invalid_signature_short_circuits(self) -> None:
        ret = solana_verify.verify_sol_transfer(
            "short", self.expected_lamports, self.TREASURY
        )
        self.assertIsInstance(ret, str)
        self.assertIn("invalid", ret.lower())

    def test_missing_treasury_short_circuits(self) -> None:
        ret = solana_verify.verify_sol_transfer(self.sig, self.expected_lamports, "")
        self.assertIsInstance(ret, str)
        self.assertIn("treasury", ret.lower())


if __name__ == "__main__":
    unittest.main()

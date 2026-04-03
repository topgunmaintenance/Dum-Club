"""
Solana DUM Token minting service.

Calls the Node.js script to mint DUM SPL tokens to a user's wallet.
This is a best-effort operation — if minting fails, the DB balance
is still the source of truth for UX.

Required env vars:
  DUM_TREASURY_KEYPAIR — base58 secret key
  DUM_MINT — SPL token mint address
  SOLANA_RPC_URL — RPC endpoint (optional, defaults to devnet)
"""

import os
import subprocess
import json


DUM_MINT = os.getenv("DUM_MINT", "") or os.getenv("DUM_MINT_ADDRESS", "")
DUM_TREASURY_KEYPAIR = os.getenv("DUM_TREASURY_KEYPAIR", "")


def is_solana_enabled() -> bool:
    """Check if Solana minting is configured."""
    return bool(DUM_MINT and DUM_TREASURY_KEYPAIR)


def mint_dum_to_wallet(wallet_address: str, amount: int) -> dict | None:
    """
    Mint DUM tokens to a user's Solana wallet.
    Returns mint result dict or None if minting is not configured or fails.
    This is best-effort — failures are logged but not raised.
    """
    if not is_solana_enabled():
        print(f"[solana] minting skipped — DUM_MINT or DUM_TREASURY_KEYPAIR not set")
        return None

    if not wallet_address or amount <= 0:
        return None

    try:
        env = {
            **os.environ,
            "DUM_TREASURY_KEYPAIR": DUM_TREASURY_KEYPAIR,
            "DUM_MINT": DUM_MINT,
        }

        result = subprocess.run(
            ["node", "scripts/create_dum_token.js", "mint-to", wallet_address, str(amount)],
            cwd=os.path.join(os.path.dirname(__file__), ".."),
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )

        if result.returncode != 0:
            print(f"[solana] mint failed: {result.stderr.strip()}")
            return None

        print(f"[solana] ✓ minted {amount} DUM to {wallet_address}")
        return {"wallet": wallet_address, "amount": amount, "output": result.stdout.strip()}

    except subprocess.TimeoutExpired:
        print(f"[solana] mint timed out for {wallet_address}")
        return None
    except Exception as exc:
        print(f"[solana] mint error: {exc!r}")
        return None

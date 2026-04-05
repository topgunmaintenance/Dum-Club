"""
Solana DUM Token minting service.

Calls the Node.js script to mint real DUM SPL tokens to a user's wallet.
Returns the transaction signature for on-chain verification.

Required env vars:
  DUM_TREASURY_KEYPAIR — base58 secret key
  DUM_MINT — SPL token mint address (J5hiqRLs9Cnj2Yr5q98XN9e2ZeEcmyXabC5dXfQGzq3U)
  SOLANA_RPC_URL — RPC endpoint (optional, defaults to devnet)
"""

import os
import subprocess
import json


DUM_MINT = os.getenv("DUM_MINT", "") or os.getenv("DUM_MINT_ADDRESS", "")
DUM_TREASURY_KEYPAIR = os.getenv("DUM_TREASURY_KEYPAIR", "")
DUM_TREASURY_WALLET = os.getenv("DUM_TREASURY_WALLET", "")


def is_solana_enabled() -> bool:
    """Check if Solana minting is configured."""
    return bool(DUM_MINT and DUM_TREASURY_KEYPAIR)


def mint_dum_to_wallet(wallet_address: str, amount: int) -> dict | None:
    """
    Mint real DUM SPL tokens to a user's Solana wallet.
    Returns dict with transaction signature, or None if failed.
    Creates the user's ATA (Associated Token Account) if it doesn't exist.
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

        # Parse JSON output from the Node.js script
        stdout = result.stdout.strip()
        try:
            mint_result = json.loads(stdout)
            sig = mint_result.get("signature", "")
            print(f"[solana] ✓ minted {amount} DUM to {wallet_address} | tx: {sig}")
            return {
                "signature": sig,
                "wallet": wallet_address,
                "amount": amount,
                "ata": mint_result.get("ata", ""),
                "mint": mint_result.get("mint", DUM_MINT),
            }
        except json.JSONDecodeError:
            # Fallback: old script format without JSON
            print(f"[solana] ✓ minted {amount} DUM to {wallet_address} (no signature parsed)")
            return {"wallet": wallet_address, "amount": amount, "signature": ""}

    except subprocess.TimeoutExpired:
        print(f"[solana] mint timed out for {wallet_address}")
        return None
    except Exception as exc:
        print(f"[solana] mint error: {exc!r}")
        return None


def get_dum_balance(wallet_address: str) -> int | None:
    """
    Read a user's DUM token balance directly from the Solana blockchain.
    Returns the token balance as an integer, or None if failed.
    """
    if not DUM_MINT:
        return None

    try:
        import requests
        rpc_url = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")

        # Get token accounts for this wallet + mint
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenAccountsByOwner",
            "params": [
                wallet_address,
                {"mint": DUM_MINT},
                {"encoding": "jsonParsed"}
            ]
        }
        resp = requests.post(rpc_url, json=payload, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        accounts = data.get("result", {}).get("value", [])
        if not accounts:
            return 0

        # Sum token amounts across all ATAs (usually just one)
        total = 0
        for acc in accounts:
            info = acc.get("account", {}).get("data", {}).get("parsed", {}).get("info", {})
            token_amount = info.get("tokenAmount", {})
            total += int(token_amount.get("amount", "0")) // (10 ** int(token_amount.get("decimals", 9)))

        return total
    except Exception as exc:
        print(f"[solana] balance read failed for {wallet_address}: {exc!r}")
        return None

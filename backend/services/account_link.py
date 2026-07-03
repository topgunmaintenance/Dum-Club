"""Runtime account linking — closes the multi-DID fragmentation hole.

account_logins was seeded ONCE by migration 056 (the founder's own
DIDs). Nothing created rows for anyone who signed up after that, so a
merchant who logs in with Google today and an email code tomorrow gets
two unlinked Privy DIDs and a split identity (the exact bug that hit
founding merchant #1).

ensure_account_link() runs best-effort on authenticated merchant
entry points. It resolves the DID's VERIFIED email server-side via
Privy's user API (Basic auth with PRIVY_APP_SECRET) — never trusting
a client-supplied email, which would let anyone claim someone else's
account — then links the DID to the existing account with that email,
or creates a fresh account.

No PRIVY_APP_SECRET configured -> logs once and returns None; every
caller treats None as "no link available" and continues, so this can
ship before the env var lands in Railway.
"""

import os
from typing import Optional, Tuple

import httpx

PRIVY_APP_ID = os.getenv("PRIVY_APP_ID")
PRIVY_APP_SECRET = os.getenv("PRIVY_APP_SECRET")

_warned_no_secret = False


def _fetch_privy_identity(privy_did: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (verified_email, provider) for a DID, or (None, None)."""
    global _warned_no_secret
    if not PRIVY_APP_ID or not PRIVY_APP_SECRET:
        if not _warned_no_secret:
            print("[account_link] PRIVY_APP_SECRET not set - runtime account linking disabled")
            _warned_no_secret = True
        return None, None
    try:
        res = httpx.get(
            f"https://auth.privy.io/api/v1/users/{privy_did}",
            auth=(PRIVY_APP_ID, PRIVY_APP_SECRET),
            headers={"privy-app-id": PRIVY_APP_ID},
            timeout=8.0,
        )
        if res.status_code != 200:
            print(f"[account_link] privy user fetch {res.status_code} for {privy_did[-6:]}")
            return None, None
        data = res.json()
        for acct in data.get("linked_accounts", []):
            typ = acct.get("type") or ""
            if typ == "email" and acct.get("address"):
                return str(acct["address"]).strip().lower(), "email"
            if typ == "google_oauth" and acct.get("email"):
                return str(acct["email"]).strip().lower(), "google"
        return None, None
    except Exception as exc:
        print(f"[account_link] privy fetch failed for {privy_did[-6:]}: {exc!r}")
        return None, None


def ensure_account_link(supabase, privy_id: str) -> Optional[str]:
    """Idempotent: map this DID to a canonical account. Returns account_id
    (existing or new) or None when linking isn't possible. Never raises."""
    try:
        existing = (
            supabase.table("account_logins")
            .select("account_id")
            .eq("privy_did", privy_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]["account_id"]

        email, provider = _fetch_privy_identity(privy_id)
        if not email:
            return None

        # Existing account with this verified email? (primary_email is
        # UNIQUE, so this is the canonical lookup.)
        acct = (
            supabase.table("accounts")
            .select("id")
            .eq("primary_email", email)
            .limit(1)
            .execute()
        )
        if acct.data:
            account_id = acct.data[0]["id"]
        else:
            try:
                created = (
                    supabase.table("accounts")
                    .insert({"primary_email": email})
                    .execute()
                )
                account_id = created.data[0]["id"]
            except Exception:
                # Unique-race: someone else inserted between our select
                # and insert. Re-read.
                retry = (
                    supabase.table("accounts")
                    .select("id")
                    .eq("primary_email", email)
                    .limit(1)
                    .execute()
                )
                if not retry.data:
                    raise
                account_id = retry.data[0]["id"]

        supabase.table("account_logins").insert({
            "account_id": account_id,
            "privy_did": privy_id,
            "provider": provider,
            "linked_email": email,
            "verified_at": "now()",
        }).execute()
        print(f"[account_link] linked {privy_id[-6:]} -> account {account_id[:8]} via {provider}")
        return account_id
    except Exception as exc:
        print(f"[account_link] ensure failed for {privy_id[-6:]}: {exc!r}")
        return None

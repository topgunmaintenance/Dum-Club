"""
seed_claim — auto-claim helper for seed-sentinel business_profiles rows.

Doctrine: seed migrations (031_topgun_storefront_seed.sql et al) insert
business_profiles + projects with owner_privy_id='seed:<slug>' so the
real merchant can claim ownership later by signing in. Without this
auto-claim, the merchant's first sign-in leaves them unable to reach
their own dashboard — the merchants / business_profiles row is still
linked to the sentinel, not to their Privy DID.

Claim rule: if the authenticated user's verified email (from the
users.email cache populated by /api/auth/sync) matches a seed row's
contact_email (case-insensitive), rebind that row + its linked
projects to the user's Privy DID.

Idempotent: a second call is a no-op because the WHERE clause requires
owner_privy_id LIKE 'seed:%'. Once rebound, the row no longer matches.

Audit: every successful claim writes a row to seed_claim_audit so we
have a paper trail for which Privy DID took ownership of which seed
when. The audit table is created lazily by the migration that ships
with this helper (036_seed_claim_audit.sql).

Safe to call from any authenticated endpoint. Failure is logged but
never raised — a claim issue should not break a working dashboard
load.
"""

from typing import Optional

from db.supabase import get_client


def maybe_claim_seed_profiles(privy_id: str) -> int:
    """
    Rebind any seed-sentinel business_profiles whose contact_email
    matches the authenticated user's cached email to this privy_id.

    Returns the number of business_profiles rows rebound. 0 is the
    normal steady-state — a real user who has already claimed their
    row, or a user who has no seed row matching their email.

    Args:
        privy_id: The authenticated user's Privy DID (current_user['sub']).
    """
    if not privy_id:
        return 0

    sb = get_client()

    try:
        # 1. Look up the user's cached email. /api/auth/sync writes
        # this on every Privy session refresh, so on a true first
        # sign-in the row should already exist.
        user_res = (
            sb.table("users")
            .select("email")
            .eq("privy_id", privy_id)
            .limit(1)
            .execute()
        )
        if not user_res.data:
            return 0
        email: Optional[str] = (user_res.data[0] or {}).get("email")
        if not email:
            return 0
        email_lower = email.strip().lower()
        if not email_lower:
            return 0

        # 2. Find any seed business_profiles whose contact_email matches.
        # The 'seed:%' prefix is the load-bearing scope guard — we never
        # touch a real user's row even if emails collide.
        candidates_res = (
            sb.table("business_profiles")
            .select("id, owner_privy_id, contact_email, business_name")
            .ilike("owner_privy_id", "seed:%")
            .ilike("contact_email", email_lower)
            .execute()
        )
        candidates = candidates_res.data or []
        if not candidates:
            return 0

        claimed = 0
        for row in candidates:
            bp_id = row.get("id")
            old_owner = row.get("owner_privy_id")
            if not bp_id or not old_owner:
                continue

            # 3a. Rebind the business_profiles row.
            sb.table("business_profiles").update(
                {"owner_privy_id": privy_id}
            ).eq("id", bp_id).eq("owner_privy_id", old_owner).execute()

            # 3b. Move every projects row linked to this business_profile
            # to the same Privy DID. business_profile_id is the join key;
            # privy_id on projects is the legacy owner column we keep in
            # sync so existing /api/projects?owner_id=... callers still
            # find the storefront under the new owner.
            sb.table("projects").update(
                {"privy_id": privy_id}
            ).eq("business_profile_id", bp_id).eq("privy_id", old_owner).execute()

            # 3c. Audit trail. Best-effort — if the table is missing
            # in a dev env the claim itself has already succeeded.
            try:
                sb.table("seed_claim_audit").insert(
                    {
                        "business_profile_id": bp_id,
                        "old_owner_privy_id": old_owner,
                        "new_owner_privy_id": privy_id,
                        "matched_email": email_lower,
                    }
                ).execute()
            except Exception as audit_exc:
                print(
                    f"[seed_claim] audit insert failed for bp={bp_id}: {audit_exc!r}"
                )

            claimed += 1
            print(
                f"[seed_claim] rebound business_profile id={bp_id} "
                f"({row.get('business_name')!r}) from {old_owner!r} "
                f"to ...{privy_id[-6:]} via email match"
            )

        return claimed

    except Exception as exc:
        # Never let a claim failure break the calling endpoint.
        print(f"[seed_claim] maybe_claim_seed_profiles failed: {exc!r}")
        return 0

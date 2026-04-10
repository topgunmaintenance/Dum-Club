"""
External business endpoints.

Handles off-platform business interactions:
- Demand event logging (view, click, purchase claim)
- Proof-of-purchase submission
- Purchase proof verification (admin)
- Merchant outreach queue
- Business claim scaffold
- Analytics / metrics
"""

import json
import os
import secrets
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.privy import require_admin

from db.supabase import get_client
from api.routes.feature_flags import get_flag
from services.agents._dedup import receipt_hash as _receipt_hash
from services.agents.purchase_proof import PurchaseProofAgent

router = APIRouter()

_FLAT_REWARD = 10  # flat 10 DUM per verified off-platform purchase


def _build_growth_context(sb, external_business_id: str, buyer_privy_id: str, campaign_type: str | None) -> dict:
    """Build user-facing growth context for a verified proof.
    Pure reads — no writes. Used by both submit-proof (auto-verify)
    and verify-proof (admin) to enrich the response."""

    # Business name
    biz = sb.table("external_businesses").select("name, status").eq("id", external_business_id).limit(1).execute()
    biz_data = biz.data[0] if biz.data else {}
    business_name = biz_data.get("name", "this business")

    # Business status: is it claimed / linked to an on-platform project?
    biz_status = biz_data.get("status", "unclaimed")
    business_on_platform = biz_status == "claimed"

    # Verified proof count for this business
    biz_proofs = (
        sb.table("purchase_proofs")
        .select("id", count="exact")
        .eq("external_business_id", external_business_id)
        .eq("status", "verified")
        .execute()
    )
    proof_count = biz_proofs.count or 0

    # This buyer's verified visits to this business
    buyer_visits = (
        sb.table("purchase_proofs")
        .select("id", count="exact")
        .eq("external_business_id", external_business_id)
        .eq("buyer_privy_id", buyer_privy_id)
        .eq("status", "verified")
        .execute()
    )
    visit_count = buyer_visits.count or 0

    # Growth tier label
    if proof_count <= 1:
        growth_tier = "just_discovered"
    elif proof_count <= 5:
        growth_tier = "growing"
    else:
        growth_tier = "popular"

    # Impact message
    impact_messages = {
        "lead_credit": f"You discovered {business_name}. This business is now being tracked on Dum Club.",
        "first_visit": f"You're one of the first customers here. {business_name} is gaining traction on Dum Club.",
        "repeat_visit": f"You're a returning customer. {business_name} is building loyalty on Dum Club.",
    }
    impact_message = impact_messages.get(campaign_type or "", f"Your purchase at {business_name} has been verified.")

    return {
        "business_name": business_name,
        "business_status": "on_platform" if business_on_platform else "not_on_platform",
        "proof_count_for_business": proof_count,
        "user_visit_count": visit_count,
        "growth_tier": growth_tier,
        "impact_message": impact_message,
    }


# ── Request/Response Models ──

class DemandEventRequest(BaseModel):
    external_business_id: str = ""
    external_source: str = ""
    external_place_id: str = ""
    business_name: str = ""
    buyer_privy_id: str = ""
    query_text: str = ""
    demand_type: str = "view"  # view, click, purchase_claim


class ProofSubmitRequest(BaseModel):
    external_business_id: str
    buyer_privy_id: str
    receipt_image_url: str = ""
    receipt_text: str = ""
    purchase_amount_usd: float = 0
    purchase_date: Optional[str] = None
    # Additive: user-typed merchant override for the Purchase Proof Agent.
    # Ignored when purchase_proof_agent_enabled is off.
    merchant_name: str = ""  # YYYY-MM-DD


class ProofVerifyRequest(BaseModel):
    proof_id: str
    status: str  # verified, rejected
    verification_notes: str = ""


class ClaimBusinessRequest(BaseModel):
    claim_token: str
    owner_privy_id: str


# ── Helpers ──
# _receipt_hash lives in services/agents/_dedup.py so the PurchaseProofAgent
# and this route share the same hashing function. Do not duplicate it here.


def _calculate_reward(amount_usd: float) -> int:
    """Flat 10 DUM per verified purchase. Amount must be positive."""
    if amount_usd <= 0:
        return 0
    return _FLAT_REWARD


async def _apply_verified_side_effects(
    sb,
    proof_id: str,
    buyer_privy_id: str,
    external_business_id: str,
    amount_usd: float,
    *,
    purchase_date: str | None = None,
    referring_privy_id: str | None = None,
) -> int:
    """
    Flag-gated dispatcher for off-platform reward application.

    When `rewards_agent_enabled` is OFF, runs the legacy body
    byte-for-byte: flat 10 DUM via _update_balance_and_log with the
    existing `proof:<id>` reference_id, a verified demand event insert,
    and an outreach queue entry. This is the behavior that has been in
    production since PR 2.

    When `rewards_agent_enabled` is ON, delegates to RewardsAgent, the
    single source of truth for off-platform reward math. The agent
    performs its own idempotency check against dum_transactions
    reference_id (`proof:<id>` and `proof:<id>:ref`), computes reward
    tiers using the distinct `business_first_verified_purchase` and
    `buyer_first_visit_to_business` concepts, applies daily caps,
    writes the ledger row(s), logs the verified demand event, and
    persists campaign_type onto the proof row. This helper then
    still queues outreach (flag-gated, unchanged).

    The caller is responsible for the purchase_proofs row update
    (status, dum_points_awarded). Outreach "sent" state invariant is
    preserved either way — no outreach row is marked sent here.

    Returns the number of points awarded to the buyer's ledger.
    """
    if get_flag("rewards_agent_enabled"):
        return await _apply_verified_side_effects_via_agent(
            sb,
            proof_id=proof_id,
            buyer_privy_id=buyer_privy_id,
            external_business_id=external_business_id,
            amount_usd=amount_usd,
            purchase_date=purchase_date,
            referring_privy_id=referring_privy_id,
        )
    return _apply_verified_side_effects_legacy(
        sb,
        proof_id=proof_id,
        buyer_privy_id=buyer_privy_id,
        external_business_id=external_business_id,
        amount_usd=amount_usd,
    )


def _apply_verified_side_effects_legacy(
    sb,
    *,
    proof_id: str,
    buyer_privy_id: str,
    external_business_id: str,
    amount_usd: float,
) -> int:
    """
    Byte-for-byte equivalent of the pre-RewardsAgent behavior. Runs when
    `rewards_agent_enabled` is off. Do not delete until the agent has
    soaked in production.
    """
    points = _calculate_reward(amount_usd or 0)

    try:
        from api.routes.dum_points import _update_balance_and_log
        _update_balance_and_log(
            sb,
            buyer_privy_id,
            points,
            "verified_off_platform_purchase",
            f"proof:{proof_id}",
        )
    except Exception as e:
        print(f"[external-biz] Failed to award DUM points: {e}")

    try:
        sb.table("external_business_demand_events").insert({
            "external_business_id": external_business_id,
            "buyer_privy_id": buyer_privy_id,
            "demand_type": "verified_purchase",
            "purchase_amount_usd": amount_usd,
        }).execute()
    except Exception as e:
        print(f"[external-biz] Failed to log verified demand event: {e}")

    if get_flag("merchant_outreach_queue_enabled"):
        try:
            _queue_outreach(sb, external_business_id)
        except Exception as e:
            print(f"[external-biz] Failed to queue outreach: {e}")

    return points


async def _apply_verified_side_effects_via_agent(
    sb,
    *,
    proof_id: str,
    buyer_privy_id: str,
    external_business_id: str,
    amount_usd: float,
    purchase_date: str | None = None,
    referring_privy_id: str | None = None,
) -> int:
    """
    Agent-backed path. Runs RewardsAgent and returns the points the
    agent awarded to the buyer's ledger. Outreach queueing still
    happens here (same scope as the legacy helper) and is still gated
    by `merchant_outreach_queue_enabled`. Outreach is NOT run on an
    idempotent replay — the agent returns `idempotent_replay=True`
    and we skip the queue in that case.
    """
    from services.agents.rewards import RewardsAgent

    agent = RewardsAgent(supabase=sb)
    try:
        result = await agent.run({
            "proof_id": proof_id,
            "buyer_privy_id": buyer_privy_id,
            "external_business_id": external_business_id,
            "amount_usd": amount_usd,
            "purchase_date": purchase_date or "",
            "referring_privy_id": referring_privy_id or "",
            "commit": True,
        })
    except Exception as exc:
        print(f"[rewards-agent] DISPATCH FAILED proof={proof_id} err={type(exc).__name__}: {exc!r}")
        return 0

    data = result.data or {}
    points_awarded = int(data.get("points_awarded", 0) or 0)
    idempotent_replay = bool(data.get("idempotent_replay", False))

    print(
        f"[rewards-agent] result proof={proof_id} status={result.status} "
        f"reason={result.reason} points={points_awarded} "
        f"replay={idempotent_replay} campaign={data.get('campaign_type', '')}"
    )

    # Queue outreach only on a fresh award, not on a replay. Matches the
    # legacy helper's scope (still gated by its own flag).
    if not idempotent_replay and result.status == "ok" and get_flag("merchant_outreach_queue_enabled"):
        try:
            _queue_outreach(sb, external_business_id)
        except Exception as e:
            print(f"[external-biz] Failed to queue outreach: {e}")

    return points_awarded


# ── Demand Events ──

@router.post("/demand-event")
async def log_demand_event(req: DemandEventRequest):
    """Log a demand event (view, click, purchase_claim) for an external business."""
    sb = get_client()

    # Resolve external_business_id if not provided
    biz_id = req.external_business_id
    if not biz_id and req.external_source and req.external_place_id:
        res = (
            sb.table("external_businesses")
            .select("id")
            .eq("external_source", req.external_source)
            .eq("external_place_id", req.external_place_id)
            .limit(1)
            .execute()
        )
        if res.data:
            biz_id = res.data[0]["id"]

    if not biz_id:
        raise HTTPException(status_code=400, detail="Cannot resolve external business")

    sb.table("external_business_demand_events").insert({
        "external_business_id": biz_id,
        "buyer_privy_id": req.buyer_privy_id or None,
        "query_text": req.query_text,
        "demand_type": req.demand_type,
    }).execute()

    return {"ok": True}


# ── Proof of Purchase ──

@router.post("/submit-proof")
async def submit_proof(req: ProofSubmitRequest):
    """
    Submit proof of purchase for an off-platform business.

    When the `purchase_proof_agent_enabled` feature flag is off, this route
    behaves exactly as it did before PR 2 (byte-for-byte). When the flag is
    on, submissions flow through the PurchaseProofAgent which parses, matches,
    scores, dedups, and classifies the proof. The public response shape is
    preserved — agent details are attached under an additive `agent` key.
    """
    if not get_flag("off_platform_receipt_rewards_enabled"):
        raise HTTPException(status_code=403, detail="Off-platform receipt rewards are not enabled")

    if req.purchase_amount_usd <= 0:
        raise HTTPException(status_code=400, detail="Purchase amount must be positive")

    sb = get_client()

    if get_flag("purchase_proof_agent_enabled"):
        return await _submit_proof_via_agent(sb, req)

    return _submit_proof_legacy(sb, req)


def _submit_proof_legacy(sb, req: ProofSubmitRequest) -> dict:
    """
    Byte-for-byte equivalent of the pre-PR-2 submit_proof body. Runs when
    the agent flag is off so we have a clean rollback.
    """
    # Check business exists
    biz = sb.table("external_businesses").select("id, name").eq("id", req.external_business_id).limit(1).execute()
    if not biz.data:
        raise HTTPException(status_code=404, detail="External business not found")

    # Dedup check
    dt_str = req.purchase_date or str(date.today())
    dup_hash = _receipt_hash(req.buyer_privy_id, req.external_business_id, req.purchase_amount_usd, dt_str)

    existing = sb.table("purchase_proofs").select("id").eq("duplicate_hash", dup_hash).limit(1).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="A similar proof has already been submitted")

    # Insert proof
    proof = sb.table("purchase_proofs").insert({
        "external_business_id": req.external_business_id,
        "buyer_privy_id": req.buyer_privy_id,
        "receipt_image_url": req.receipt_image_url or None,
        "receipt_text": req.receipt_text or None,
        "purchase_amount_usd": req.purchase_amount_usd,
        "purchase_date": dt_str,
        "status": "pending",
        "duplicate_hash": dup_hash,
    }).execute()

    # Also log demand event
    sb.table("external_business_demand_events").insert({
        "external_business_id": req.external_business_id,
        "buyer_privy_id": req.buyer_privy_id,
        "demand_type": "purchase_claim",
        "purchase_amount_usd": req.purchase_amount_usd,
    }).execute()

    proof_id = proof.data[0]["id"] if proof.data else None
    return {"ok": True, "proof_id": proof_id, "status": "pending", "potential_reward": _calculate_reward(req.purchase_amount_usd)}


async def _submit_proof_via_agent(sb, req: ProofSubmitRequest) -> dict:
    """
    Agent-backed submit path. Runs PurchaseProofAgent, persists the agent
    output fields to purchase_proofs, and optionally auto-verifies when
    `purchase_proof_auto_verify_enabled` is on AND the agent returned
    `approved`.
    """
    agent = PurchaseProofAgent(supabase=sb)
    result = await agent.run({
        "buyer_privy_id": req.buyer_privy_id,
        "external_business_id": req.external_business_id,
        "receipt_image_url": req.receipt_image_url,
        "receipt_text": req.receipt_text,
        "purchase_amount_usd": req.purchase_amount_usd,
        "purchase_date": req.purchase_date or "",
        "merchant_name": req.merchant_name,
    })

    data = result.data or {}
    decision = data.get("decision", "review")
    reason = data.get("reason", "")

    # Hard-reject translations — preserve existing HTTP contract
    if result.status == "reject":
        if reason == "duplicate_receipt":
            raise HTTPException(status_code=409, detail="A similar proof has already been submitted")
        if reason == "business_not_found":
            raise HTTPException(status_code=404, detail="External business not found")
        if reason == "empty_submission":
            raise HTTPException(status_code=400, detail="Submission is empty")
        # Any other reject reason (future codes) — return 400 with the reason
        raise HTTPException(status_code=400, detail=f"Proof rejected: {reason or 'unknown'}")

    # At this point result.status is "ok" (approved) or "review"
    dt_str = data.get("parsed_date") or req.purchase_date or str(date.today())
    auto_verify = (
        result.status == "ok"
        and decision == "approved"
        and get_flag("purchase_proof_auto_verify_enabled")
    )
    proof_status = "verified" if auto_verify else "pending"

    # Stored notes are JSON-serialised for easy future querying. Keep small.
    notes_payload = {
        "reason": reason,
        "merchant_match": data.get("merchant_match_strength"),
        "breakdown": data.get("score_breakdown") or {},
    }
    try:
        agent_notes = json.dumps(notes_payload, default=str)[:1000]
    except Exception:
        agent_notes = reason or ""

    row_to_insert: dict = {
        "external_business_id": req.external_business_id,
        "buyer_privy_id": req.buyer_privy_id,
        "receipt_image_url": req.receipt_image_url or None,
        "receipt_text": req.receipt_text or None,
        "purchase_amount_usd": req.purchase_amount_usd,
        "purchase_date": dt_str,
        "status": proof_status,
        "duplicate_hash": data.get("dedup_hash") or None,
        "parsed_merchant": data.get("parsed_merchant") or None,
        "parsed_amount": data.get("parsed_amount") or None,
        "parsed_date": data.get("parsed_date") or None,
        "confidence": round(float(result.confidence), 3),
        "agent_decision": decision,
        "agent_notes": agent_notes,
    }

    proof = sb.table("purchase_proofs").insert(row_to_insert).execute()
    proof_id = proof.data[0]["id"] if proof.data else None

    # Always log the initial claim demand event (matches legacy behavior)
    try:
        sb.table("external_business_demand_events").insert({
            "external_business_id": req.external_business_id,
            "buyer_privy_id": req.buyer_privy_id,
            "demand_type": "purchase_claim",
            "purchase_amount_usd": req.purchase_amount_usd,
        }).execute()
    except Exception as e:
        print(f"[external-biz] Failed to log purchase_claim event: {e}")

    points_awarded = 0
    if auto_verify and proof_id:
        points_awarded = await _apply_verified_side_effects(
            sb,
            proof_id=proof_id,
            buyer_privy_id=req.buyer_privy_id,
            external_business_id=req.external_business_id,
            amount_usd=req.purchase_amount_usd,
            purchase_date=req.purchase_date,
        )
        try:
            sb.table("purchase_proofs").update(
                {"dum_points_awarded": points_awarded}
            ).eq("id", proof_id).execute()
        except Exception as e:
            print(f"[external-biz] Failed to persist dum_points_awarded: {e}")

    response = {
        "ok": True,
        "proof_id": proof_id,
        "status": proof_status,
        "potential_reward": _calculate_reward(req.purchase_amount_usd),
        # Additive debug block — existing clients ignore unknown keys.
        "agent": {
            "decision": decision,
            "reason": reason,
            "confidence": round(float(result.confidence), 4),
            "auto_verified": auto_verify,
            "points_awarded": points_awarded,
        },
    }

    # Enrich auto-verified proofs with growth context for immediate user feedback
    if auto_verify and proof_id:
        try:
            # Read back campaign_type set by RewardsAgent
            final = sb.table("purchase_proofs").select("campaign_type").eq("id", proof_id).limit(1).execute()
            campaign_type = final.data[0].get("campaign_type") if final.data else None
            response["campaign_type"] = campaign_type
            response["growth"] = _build_growth_context(
                sb, req.external_business_id, req.buyer_privy_id, campaign_type
            )
        except Exception as e:
            print(f"[external-biz] submit growth context failed: {e}")

    return response


# ── Proof Verification (admin) ──

@router.post("/verify-proof")
async def verify_proof(req: ProofVerifyRequest, _admin=Depends(require_admin)):
    """Verify or reject a purchase proof. Awards DUM Points on verification."""
    sb = get_client()

    proof = sb.table("purchase_proofs").select("*").eq("id", req.proof_id).limit(1).execute()
    if not proof.data:
        raise HTTPException(status_code=404, detail="Proof not found")

    p = proof.data[0]
    if p["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Proof already {p['status']}")

    update: dict = {"status": req.status, "verification_notes": req.verification_notes}

    if req.status == "verified":
        points = await _apply_verified_side_effects(
            sb,
            proof_id=req.proof_id,
            buyer_privy_id=p["buyer_privy_id"],
            external_business_id=p["external_business_id"],
            amount_usd=p.get("purchase_amount_usd") or 0,
            purchase_date=p.get("purchase_date"),
            referring_privy_id=p.get("referring_privy_id"),
        )
        update["dum_points_awarded"] = points

    sb.table("purchase_proofs").update(update).eq("id", req.proof_id).execute()

    # Read back campaign_type (set by RewardsAgent directly on the proof row)
    final = sb.table("purchase_proofs").select("campaign_type").eq("id", req.proof_id).limit(1).execute()
    campaign_type = final.data[0].get("campaign_type") if final.data else None

    response: dict = {
        "ok": True,
        "status": req.status,
        "points_awarded": update.get("dum_points_awarded", 0),
        "campaign_type": campaign_type,
    }

    # Enrich with growth context on successful verification
    if req.status == "verified":
        try:
            response["growth"] = _build_growth_context(
                sb, p["external_business_id"], p["buyer_privy_id"], campaign_type
            )
        except Exception as e:
            print(f"[external-biz] growth context failed: {e}")

    return response


# ── Reward Preview (admin, read-only) ──

@router.get("/proof-reward-preview/{proof_id}")
async def proof_reward_preview(proof_id: str, _admin=Depends(require_admin)):
    """Preview the expected reward for a pending proof WITHOUT verifying it.
    Pure read — no writes, no side effects."""
    sb = get_client()

    proof = sb.table("purchase_proofs").select("*").eq("id", proof_id).limit(1).execute()
    if not proof.data:
        raise HTTPException(status_code=404, detail="Proof not found")
    p = proof.data[0]

    biz_id = p["external_business_id"]
    buyer_id = p["buyer_privy_id"]

    # Resolve business name
    biz = sb.table("external_businesses").select("name").eq("id", biz_id).limit(1).execute()
    business_name = biz.data[0]["name"] if biz.data else "Unknown business"

    # Resolve buyer balance
    user = sb.table("users").select("dum_balance, email").eq("privy_id", buyer_id).limit(1).execute()
    buyer_balance = user.data[0]["dum_balance"] if user.data else 0
    buyer_email = user.data[0].get("email", "") if user.data else ""

    # Classify: check demand events to predict campaign_type
    biz_demand = (
        sb.table("external_business_demand_events")
        .select("id", count="exact")
        .eq("external_business_id", biz_id)
        .eq("demand_type", "verified_purchase")
        .limit(1)
        .execute()
    )
    business_first = (biz_demand.count or 0) == 0

    buyer_demand = (
        sb.table("external_business_demand_events")
        .select("id", count="exact")
        .eq("external_business_id", biz_id)
        .eq("buyer_privy_id", buyer_id)
        .eq("demand_type", "verified_purchase")
        .limit(1)
        .execute()
    )
    buyer_first_visit = (buyer_demand.count or 0) == 0

    if business_first:
        campaign_type = "lead_credit"
        points_expected = 25
    elif buyer_first_visit:
        campaign_type = "first_visit"
        points_expected = 15
    else:
        campaign_type = "repeat_visit"
        points_expected = 10

    # Check idempotency — already awarded?
    existing = (
        sb.table("dum_transactions")
        .select("id", count="exact")
        .eq("reference_id", f"proof:{proof_id}")
        .limit(1)
        .execute()
    )
    already_awarded = (existing.count or 0) > 0

    return {
        "proof_id": proof_id,
        "business_name": business_name,
        "buyer_privy_id": buyer_id,
        "buyer_email": buyer_email,
        "buyer_balance": buyer_balance,
        "purchase_amount_usd": p.get("purchase_amount_usd"),
        "purchase_date": p.get("purchase_date"),
        "campaign_type": campaign_type,
        "points_expected": points_expected,
        "balance_after": buyer_balance + (0 if already_awarded else points_expected),
        "already_awarded": already_awarded,
        "status": p["status"],
    }


# ── Admin Proof Listing ──

@router.get("/all-proofs")
async def list_all_proofs(status: str = "pending", _admin=Depends(require_admin)):
    """List all purchase proofs filtered by status. For admin review.
    Enriches each proof with business_name and campaign_type prediction."""
    sb = get_client()
    res = (
        sb.table("purchase_proofs")
        .select("id, external_business_id, buyer_privy_id, receipt_text, purchase_amount_usd, purchase_date, status, dum_points_awarded, verification_notes, campaign_type, created_at")
        .eq("status", status)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    proofs = res.data or []
    if not proofs:
        return []

    # Batch-resolve business names
    biz_ids = list({p["external_business_id"] for p in proofs})
    biz_res = sb.table("external_businesses").select("id, name").in_("id", biz_ids).execute()
    biz_map = {b["id"]: b["name"] for b in (biz_res.data or [])}

    # For pending proofs, predict campaign_type from demand events
    if status == "pending":
        demand_res = (
            sb.table("external_business_demand_events")
            .select("external_business_id, buyer_privy_id")
            .in_("external_business_id", biz_ids)
            .eq("demand_type", "verified_purchase")
            .execute()
        )
        demand_rows = demand_res.data or []
        # Sets for fast lookup
        biz_with_verified = {d["external_business_id"] for d in demand_rows}
        buyer_biz_pairs = {(d["buyer_privy_id"], d["external_business_id"]) for d in demand_rows}

        for p in proofs:
            bid = p["external_business_id"]
            uid = p["buyer_privy_id"]
            if bid not in biz_with_verified:
                p["campaign_type_preview"] = "lead_credit"
                p["points_expected"] = 25
            elif (uid, bid) not in buyer_biz_pairs:
                p["campaign_type_preview"] = "first_visit"
                p["points_expected"] = 15
            else:
                p["campaign_type_preview"] = "repeat_visit"
                p["points_expected"] = 10

    for p in proofs:
        p["business_name"] = biz_map.get(p["external_business_id"], "Unknown")

    return proofs


def _queue_outreach(sb, external_business_id: str):
    """Create a merchant outreach queue entry after a verified purchase."""
    # Check if outreach already queued for this business
    existing = (
        sb.table("merchant_outreach_queue")
        .select("id")
        .eq("external_business_id", external_business_id)
        .in_("outreach_status", ["pending", "sent"])
        .limit(1)
        .execute()
    )
    if existing.data:
        return  # Already queued

    # Get business info
    biz = sb.table("external_businesses").select("name, phone, website").eq("id", external_business_id).limit(1).execute()
    biz_data = biz.data[0] if biz.data else {}
    biz_name = biz_data.get("name", "your business")

    claim_token = secrets.token_urlsafe(32)

    sb.table("merchant_outreach_queue").insert({
        "external_business_id": external_business_id,
        "trigger_source": "verified_purchase",
        "outreach_channel": "email" if biz_data.get("website") else "manual",
        "outreach_status": "pending",
        "message_subject": f"A customer discovered {biz_name} through DUM Club",
        "message_body": (
            f"A customer recently purchased from {biz_name} after discovering it through DUM Club. "
            f"You can claim your business on DUM Club to turn that demand into repeat customers, "
            f"launch offers, and reward buyers. Claim your business here."
        ),
        "claim_token": claim_token,
    }).execute()

    # Update business status
    sb.table("external_businesses").update({"status": "outreach_sent"}).eq("id", external_business_id).execute()


# ── Business Claim ──

@router.post("/claim")
async def claim_business(req: ClaimBusinessRequest):
    """Scaffold for business claim flow. Validates claim token and marks business."""
    sb = get_client()

    outreach = (
        sb.table("merchant_outreach_queue")
        .select("id, external_business_id, outreach_status")
        .eq("claim_token", req.claim_token)
        .limit(1)
        .execute()
    )
    if not outreach.data:
        raise HTTPException(status_code=404, detail="Invalid claim token")

    o = outreach.data[0]
    ext_biz_id = o["external_business_id"]

    # Mark business as claimed
    sb.table("external_businesses").update({
        "status": "claimed",
    }).eq("id", ext_biz_id).execute()

    # Update outreach record
    sb.table("merchant_outreach_queue").update({
        "outreach_status": "claimed",
    }).eq("id", o["id"]).execute()

    return {
        "ok": True,
        "external_business_id": ext_biz_id,
        "message": "Business claimed. You can now create a full DUM Club project for this business.",
    }


# ── User Proof History ──

@router.get("/my-proofs/{privy_id}")
async def get_my_proofs(privy_id: str):
    """Get all purchase proofs for a user."""
    sb = get_client()
    res = (
        sb.table("purchase_proofs")
        .select("id, external_business_id, purchase_amount_usd, purchase_date, status, dum_points_awarded, created_at")
        .eq("buyer_privy_id", privy_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    return res.data or []


# ── Analytics / Metrics ──

@router.get("/metrics")
async def get_metrics(_admin=Depends(require_admin)):
    """Return off-platform demand capture metrics."""
    sb = get_client()

    try:
        external_count = sb.table("external_businesses").select("id", count="exact").execute().count or 0
        demand_views = sb.table("external_business_demand_events").select("id", count="exact").eq("demand_type", "view").execute().count or 0
        demand_clicks = sb.table("external_business_demand_events").select("id", count="exact").eq("demand_type", "click").execute().count or 0
        proofs_total = sb.table("purchase_proofs").select("id", count="exact").execute().count or 0
        proofs_verified = sb.table("purchase_proofs").select("id", count="exact").eq("status", "verified").execute().count or 0
        proofs_pending = sb.table("purchase_proofs").select("id", count="exact").eq("status", "pending").execute().count or 0
        outreach_queued = sb.table("merchant_outreach_queue").select("id", count="exact").eq("outreach_status", "pending").execute().count or 0
        outreach_sent = sb.table("merchant_outreach_queue").select("id", count="exact").eq("outreach_status", "sent").execute().count or 0
        claimed = sb.table("external_businesses").select("id", count="exact").eq("status", "claimed").execute().count or 0
    except Exception:
        return {"error": "metrics query failed"}

    # Total DUM awarded from off-platform
    points_res = sb.table("purchase_proofs").select("dum_points_awarded").eq("status", "verified").execute()
    total_points = sum(r.get("dum_points_awarded", 0) for r in (points_res.data or []))

    return {
        "external_businesses_discovered": external_count,
        "demand_views": demand_views,
        "demand_clicks": demand_clicks,
        "purchase_proofs_submitted": proofs_total,
        "purchase_proofs_verified": proofs_verified,
        "purchase_proofs_pending": proofs_pending,
        "dum_points_awarded_off_platform": total_points,
        "merchant_outreach_queued": outreach_queued,
        "merchant_outreach_sent": outreach_sent,
        "businesses_claimed": claimed,
    }

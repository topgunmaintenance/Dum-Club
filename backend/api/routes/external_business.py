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

import hashlib
import os
import secrets
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db.supabase import get_client
from api.routes.feature_flags import get_flag

router = APIRouter()

_FLAT_REWARD = 10  # flat 10 DUM per verified off-platform purchase


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
    purchase_date: Optional[str] = None  # YYYY-MM-DD


class ProofVerifyRequest(BaseModel):
    proof_id: str
    status: str  # verified, rejected
    verification_notes: str = ""


class ClaimBusinessRequest(BaseModel):
    claim_token: str
    owner_privy_id: str


# ── Helpers ──

def _receipt_hash(buyer: str, business_id: str, amount: float, dt: str) -> str:
    """Generate a dedup hash for a receipt."""
    raw = f"{buyer}:{business_id}:{amount:.2f}:{dt}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _calculate_reward(amount_usd: float) -> int:
    """Flat 10 DUM per verified purchase. Amount must be positive."""
    if amount_usd <= 0:
        return 0
    return _FLAT_REWARD


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
    """Submit proof of purchase for an off-platform business."""
    if not get_flag("off_platform_receipt_rewards_enabled"):
        raise HTTPException(status_code=403, detail="Off-platform receipt rewards are not enabled")

    if req.purchase_amount_usd <= 0:
        raise HTTPException(status_code=400, detail="Purchase amount must be positive")

    sb = get_client()

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


# ── Proof Verification (admin) ──

@router.post("/verify-proof")
async def verify_proof(req: ProofVerifyRequest):
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
        points = _calculate_reward(p.get("purchase_amount_usd") or 0)
        update["dum_points_awarded"] = points

        # Award DUM Points via the dum_points pattern
        try:
            from api.routes.dum_points import _update_balance_and_log
            _update_balance_and_log(
                sb,
                p["buyer_privy_id"],
                points,
                "verified_off_platform_purchase",
                f"proof:{req.proof_id}",
            )
        except Exception as e:
            print(f"[external-biz] Failed to award DUM points: {e}")

        # Log verified demand event
        sb.table("external_business_demand_events").insert({
            "external_business_id": p["external_business_id"],
            "buyer_privy_id": p["buyer_privy_id"],
            "demand_type": "verified_purchase",
            "purchase_amount_usd": p.get("purchase_amount_usd"),
        }).execute()

        # Queue merchant outreach
        if get_flag("merchant_outreach_queue_enabled"):
            _queue_outreach(sb, p["external_business_id"])

    sb.table("purchase_proofs").update(update).eq("id", req.proof_id).execute()

    return {"ok": True, "status": req.status, "points_awarded": update.get("dum_points_awarded", 0)}


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
async def get_metrics():
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

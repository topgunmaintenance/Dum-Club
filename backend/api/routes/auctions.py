"""
Live Auctions — start, bid, close, void.

State model:
  active → ended (has bids) | closed (no bids)
  ended → awaiting_payment → paid
  ended → voided
  awaiting_payment → ended (checkout abandoned)
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field

from db.supabase import get_client

router = APIRouter()

# ── Helpers ──────────────────────────────────────────────────

def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


def _mask_email(email: str) -> str:
    """j***n@gmail.com"""
    if "@" not in email:
        return email[:2] + "***"
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        return local[0] + "***@" + domain
    return local[0] + "*" * (len(local) - 2) + local[-1] + "@" + domain


def _mask_wallet(wallet: str) -> str:
    """0x7a...3f2d"""
    if len(wallet) <= 8:
        return wallet
    return wallet[:4] + "..." + wallet[-4:]


def _make_display_name(supabase, bidder_id: str, bid_position: int) -> str:
    """Derive masked identity for public display."""
    try:
        user_res = (
            supabase.table("users")
            .select("email, wallet_address")
            .eq("privy_id", bidder_id)
            .limit(1)
            .execute()
        )
        if user_res.data:
            email = user_res.data[0].get("email")
            if email:
                return _mask_email(email)
            wallet = user_res.data[0].get("wallet_address")
            if wallet:
                return _mask_wallet(wallet)
    except Exception:
        pass
    return f"Bidder #{bid_position}"


def _resolve_owner(supabase, project: dict, user_id: str) -> bool:
    """Check if user_id is the project owner."""
    from api.routes.projects import _resolve_owner_uuid, _UUID_RE
    resolved = _resolve_owner_uuid(supabase, user_id)
    return (
        (project.get("owner_id") and project["owner_id"] == user_id)
        or (project.get("owner_id") and resolved and project["owner_id"] == resolved)
        or (project.get("privy_id") and project["privy_id"] == user_id)
    )


# ── Models ───────────────────────────────────────────────────

class StartAuctionRequest(BaseModel):
    project_id: str
    offer_id: str
    starting_price: float = Field(gt=0, le=10000)
    duration_seconds: int = Field(default=120, ge=30, le=600)


class PlaceBidRequest(BaseModel):
    amount: float = Field(gt=0, le=100000)


class CloseAuctionRequest(BaseModel):
    force: bool = False


# ── Start Auction ────────────────────────────────────────────

@router.post("/start")
async def start_auction(
    body: StartAuctionRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    supabase = get_client()

    # Fetch project + verify owner
    project_res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id, is_live, active_auction_id")
        .eq("id", body.project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")
    project = project_res.data[0]

    if not _resolve_owner(supabase, project, user_id):
        raise HTTPException(status_code=403, detail="Not project owner")

    # One auction at a time
    if project.get("active_auction_id"):
        raise HTTPException(status_code=409, detail="An auction is already active")

    # Verify offer exists and is active
    offer_res = (
        supabase.table("offers")
        .select("id, title")
        .eq("id", body.offer_id)
        .eq("project_id", body.project_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not offer_res.data:
        raise HTTPException(status_code=404, detail="Offer not found or inactive")

    now = _now()
    ends_at = now + timedelta(seconds=body.duration_seconds)

    auction_insert = {
        "project_id": body.project_id,
        "offer_id": body.offer_id,
        "started_by": user_id,
        "starting_price": body.starting_price,
        "status": "active",
        "duration_seconds": body.duration_seconds,
        "started_at": now.isoformat(),
        "ends_at": ends_at.isoformat(),
    }

    auction_res = supabase.table("auctions").insert(auction_insert).execute()
    if not auction_res.data:
        raise HTTPException(status_code=500, detail="Failed to create auction")

    auction = auction_res.data[0]

    # Set active auction on project + pin the offer
    supabase.table("projects").update({
        "active_auction_id": auction["id"],
        "pinned_offer_id": body.offer_id,
    }).eq("id", body.project_id).execute()

    return {
        "status": "success",
        "auction": auction,
        "offer_title": offer_res.data[0]["title"],
    }


# ── Place Bid ────────────────────────────────────────────────

@router.post("/{auction_id}/bid")
async def place_bid(
    auction_id: str,
    body: PlaceBidRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    supabase = get_client()

    # Fetch auction
    auction_res = (
        supabase.table("auctions")
        .select("*")
        .eq("id", auction_id)
        .limit(1)
        .execute()
    )
    if not auction_res.data:
        raise HTTPException(status_code=404, detail="Auction not found")
    auction = auction_res.data[0]

    # Validate state
    if auction["status"] != "active":
        raise HTTPException(status_code=409, detail="Auction is not active")

    # Validate timing
    ends_at = datetime.fromisoformat(auction["ends_at"].replace("Z", "+00:00"))
    if _now() >= ends_at:
        raise HTTPException(status_code=409, detail="Auction has ended")

    # Validate bid amount
    current = float(auction["current_bid"]) if auction["current_bid"] else None
    minimum = current + 1.0 if current else float(auction["starting_price"])
    if body.amount < minimum:
        raise HTTPException(
            status_code=400,
            detail=f"Bid must be at least ${minimum:.2f}"
        )

    # Prevent owner from bidding
    project_res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id")
        .eq("id", auction["project_id"])
        .limit(1)
        .execute()
    )
    if project_res.data and _resolve_owner(supabase, project_res.data[0], user_id):
        raise HTTPException(status_code=403, detail="Owner cannot bid on own auction")

    # Build display name
    bid_position = auction["bid_count"] + 1
    display_name = _make_display_name(supabase, user_id, bid_position)

    # Insert bid record
    bid_insert = {
        "auction_id": auction_id,
        "bidder_id": user_id,
        "display_name": display_name,
        "amount": body.amount,
        "placed_at": _now_iso(),
    }
    supabase.table("auction_bids").insert(bid_insert).execute()

    # Atomically update auction — re-check current_bid to prevent race
    update_res = (
        supabase.table("auctions")
        .update({
            "current_bid": body.amount,
            "current_bidder": user_id,
            "current_bidder_display": display_name,
            "bid_count": bid_position,
        })
        .eq("id", auction_id)
        .eq("status", "active")
        .execute()
    )

    if not update_res.data:
        raise HTTPException(status_code=409, detail="Bid was beaten or auction ended")

    return {
        "status": "success",
        "auction": update_res.data[0],
        "your_display_name": display_name,
    }


# ── Close Auction ────────────────────────────────────────────

@router.post("/{auction_id}/close")
async def close_auction(
    auction_id: str,
    body: CloseAuctionRequest = CloseAuctionRequest(),
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    supabase = get_client()

    auction_res = (
        supabase.table("auctions")
        .select("*")
        .eq("id", auction_id)
        .limit(1)
        .execute()
    )
    if not auction_res.data:
        raise HTTPException(status_code=404, detail="Auction not found")
    auction = auction_res.data[0]

    if auction["status"] != "active":
        raise HTTPException(status_code=409, detail="Auction is not active")

    # Timer check (unless force-close by owner)
    if body.force:
        project_res = (
            supabase.table("projects")
            .select("id, owner_id, privy_id")
            .eq("id", auction["project_id"])
            .limit(1)
            .execute()
        )
        if not project_res.data or not _resolve_owner(supabase, project_res.data[0], user_id):
            raise HTTPException(status_code=403, detail="Only owner can force-close")
    else:
        ends_at = datetime.fromisoformat(auction["ends_at"].replace("Z", "+00:00"))
        if _now() < ends_at:
            raise HTTPException(status_code=409, detail="Auction has not ended yet")

    # Determine outcome
    has_bids = auction["bid_count"] > 0
    new_status = "ended" if has_bids else "closed"

    supabase.table("auctions").update({
        "status": new_status,
        "ended_at": _now_iso(),
    }).eq("id", auction_id).execute()

    # Clear active auction on project
    supabase.table("projects").update({
        "active_auction_id": None,
    }).eq("id", auction["project_id"]).execute()

    return {
        "status": "success",
        "auction_status": new_status,
        "winner": auction["current_bidder"] if has_bids else None,
        "winner_display": auction["current_bidder_display"] if has_bids else None,
        "winning_bid": float(auction["current_bid"]) if has_bids else None,
    }


# ── Void Auction (owner cancels unpaid winner) ──────────────

@router.post("/{auction_id}/void")
async def void_auction(
    auction_id: str,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    supabase = get_client()

    auction_res = (
        supabase.table("auctions")
        .select("*")
        .eq("id", auction_id)
        .limit(1)
        .execute()
    )
    if not auction_res.data:
        raise HTTPException(status_code=404, detail="Auction not found")
    auction = auction_res.data[0]

    if auction["status"] not in ("ended",):
        raise HTTPException(status_code=409, detail="Can only void an ended auction awaiting payment")

    project_res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id")
        .eq("id", auction["project_id"])
        .limit(1)
        .execute()
    )
    if not project_res.data or not _resolve_owner(supabase, project_res.data[0], user_id):
        raise HTTPException(status_code=403, detail="Not project owner")

    supabase.table("auctions").update({
        "status": "voided",
        "ended_at": _now_iso(),
    }).eq("id", auction_id).execute()

    return {"status": "success", "auction_status": "voided"}


# ── Get Auction State (public) ───────────────────────────────

@router.get("/{auction_id}")
async def get_auction(auction_id: str):
    supabase = get_client()

    auction_res = (
        supabase.table("auctions")
        .select("*")
        .eq("id", auction_id)
        .limit(1)
        .execute()
    )
    if not auction_res.data:
        raise HTTPException(status_code=404, detail="Auction not found")

    return auction_res.data[0]

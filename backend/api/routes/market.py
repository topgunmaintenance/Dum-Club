from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from db.supabase import get_client
from datetime import datetime, timezone

router = APIRouter()

PROJECT_FEE_BPS = 150  # 1.50%
DUM_FEE_BPS = 50       # 0.50%
TOTAL_FEE_BPS = PROJECT_FEE_BPS + DUM_FEE_BPS


class TradeRequest(BaseModel):
    side: str = Field(pattern="^(buy|sell)$")
    amount: float = Field(gt=0)
    wallet: str = Field(min_length=8)


@router.get("/api/projects/{project_id}/market")
async def get_project_market(project_id: str):
    supabase = get_client()

    market_res = (
        supabase.table("project_market_state")
        .select("*")
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )

    market = market_res.data[0] if market_res.data else None

    if not market:
        return {
            "project_id": project_id,
            "price": 0.001,
            "market_cap": 0,
            "volume_24h": 0,
            "last_trade_at": None,
        }

    return market


@router.get("/api/projects/{project_id}/trades")
async def get_project_trades(project_id: str):
    supabase = get_client()

    trades_res = (
        supabase.table("project_trades")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )

    return trades_res.data or []


@router.get("/api/projects/{project_id}/balance/{wallet}")
async def get_project_balance(project_id: str, wallet: str):
    supabase = get_client()

    balance_res = (
        supabase.table("project_balances")
        .select("*")
        .eq("project_id", project_id)
        .eq("wallet_address", wallet)
        .limit(1)
        .execute()
    )

    balance_row = balance_res.data[0] if balance_res.data else None

    return {
        "project_id": project_id,
        "wallet": wallet,
        "balance": float(balance_row["balance"]) if balance_row else 0.0,
    }


@router.post("/api/projects/{project_id}/trade")
async def create_project_trade(project_id: str, body: TradeRequest):
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .single()
        .execute()
    )

    project = project_res.data
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    token_symbol = project.get("token_symbol")
    token_supply = project.get("token_supply") or 0

    if not token_symbol:
        raise HTTPException(status_code=400, detail="Project token symbol is missing")

    wallet = body.wallet.strip()
    if not wallet:
        raise HTTPException(status_code=400, detail="Wallet is required")

    market_res = (
        supabase.table("project_market_state")
        .select("*")
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )

    market = market_res.data[0] if market_res.data else {
        "project_id": project_id,
        "price": 0.001,
        "market_cap": 0,
        "volume_24h": 0,
        "last_trade_at": None,
    }

    current_price = float(market.get("price") or 0.001)
    amount = float(body.amount)
    side = body.side.lower()

    balance_res = (
        supabase.table("project_balances")
        .select("*")
        .eq("project_id", project_id)
        .eq("wallet_address", wallet)
        .limit(1)
        .execute()
    )

    balance_row = balance_res.data[0] if balance_res.data else None
    current_balance = float(balance_row["balance"]) if balance_row else 0.0

    if side == "sell" and current_balance < amount:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance. Wallet holds {current_balance:.6f} {token_symbol}."
        )

    gross_value = current_price * amount
    total_fee = gross_value * (TOTAL_FEE_BPS / 10_000)
    project_fee = gross_value * (PROJECT_FEE_BPS / 10_000)
    dum_fee = gross_value * (DUM_FEE_BPS / 10_000)
    net_value = gross_value - total_fee

    price_impact = 0.0025 * (amount / 1000.0)

    if side == "buy":
        new_price = current_price * (1 + price_impact)
        new_balance = current_balance + amount
    else:
        new_price = max(0.000001, current_price * (1 - price_impact))
        new_balance = current_balance - amount

    market_cap = new_price * float(token_supply or 0)
    now = datetime.now(timezone.utc).isoformat()

    trade_insert = {
        "project_id": project_id,
        "token_symbol": token_symbol,
        "side": side,
        "amount": round(amount, 6),
        "price": round(current_price, 8),
        "gross_value": round(gross_value, 6),
        "net_value": round(net_value, 6),
        "project_fee": round(project_fee, 6),
        "dum_fee": round(dum_fee, 6),
        "created_at": now,
        "source": wallet,
    }

    trade_res = supabase.table("project_trades").insert(trade_insert).execute()

    market_upsert = {
        "project_id": project_id,
        "price": round(new_price, 8),
        "market_cap": round(market_cap, 4),
        "volume_24h": round(float(market.get("volume_24h") or 0) + gross_value, 6),
        "last_trade_at": now,
        "updated_at": now,
    }

    supabase.table("project_market_state").upsert(
        market_upsert,
        on_conflict="project_id"
    ).execute()

    balance_upsert = {
        "wallet_address": wallet,
        "project_id": project_id,
        "token_symbol": token_symbol,
        "balance": round(new_balance, 6),
        "updated_at": now,
    }

    supabase.table("project_balances").upsert(
        balance_upsert,
        on_conflict="wallet_address,project_id"
    ).execute()

    candle_time = now[:16] + ":00Z"
    candles_res = (
        supabase.table("project_candles")
        .select("*")
        .eq("project_id", project_id)
        .eq("bucket_time", candle_time)
        .limit(1)
        .execute()
    )

    existing_candle = candles_res.data[0] if candles_res.data else None

    if not existing_candle:
        candle_insert = {
            "project_id": project_id,
            "bucket_time": candle_time,
            "open": round(current_price, 8),
            "high": round(max(current_price, new_price), 8),
            "low": round(min(current_price, new_price), 8),
            "close": round(new_price, 8),
            "volume": round(gross_value, 6),
        }
        supabase.table("project_candles").insert(candle_insert).execute()
    else:
        candle_update = {
            "high": round(max(float(existing_candle["high"]), new_price), 8),
            "low": round(min(float(existing_candle["low"]), new_price), 8),
            "close": round(new_price, 8),
            "volume": round(float(existing_candle["volume"]) + gross_value, 6),
        }
        supabase.table("project_candles").update(candle_update).eq("id", existing_candle["id"]).execute()

    return {
        "status": "success",
        "trade": trade_res.data[0] if trade_res.data else trade_insert,
        "market": {
            "project_id": project_id,
            "price": round(new_price, 8),
            "market_cap": round(market_cap, 4),
            "volume_24h": market_upsert["volume_24h"],
            "last_trade_at": now,
        },
        "balance": {
            "wallet": wallet,
            "balance": round(new_balance, 6),
        },
    }


@router.get("/api/projects/{project_id}/candles")
async def get_project_candles(project_id: str):
    supabase = get_client()

    candles_res = (
        supabase.table("project_candles")
        .select("*")
        .eq("project_id", project_id)
        .order("bucket_time", desc=False)
        .limit(200)
        .execute()
    )

    return candles_res.data or []

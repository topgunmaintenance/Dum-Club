from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db.supabase import get_client
from services.token_mode import is_simulated_token, token_mode

router = APIRouter()


def _resolve(project_id: str) -> str:
    """Resolve a slug-or-UUID path param to canonical UUID, or return the
    original value unchanged if no project matches. Returning the original
    on miss preserves the existing behavior of these endpoints (which
    silently return empty data for unknown projects rather than 404).
    """
    from api.routes.projects import resolve_project_uuid
    return resolve_project_uuid(get_client(), project_id) or project_id

PROJECT_FEE_BPS = 150  # 1.50%
DUM_FEE_BPS = 50       # 0.50%
TOTAL_FEE_BPS = PROJECT_FEE_BPS + DUM_FEE_BPS

DEFAULT_START_PRICE = Decimal("0.001")
MIN_PRICE = Decimal("0.000001")


class TradeRequest(BaseModel):
    side: str = Field(pattern="^(buy|sell)$")
    amount: float = Field(gt=0)
    wallet: str = Field(min_length=8)


def _to_decimal(value) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def _decimal_to_float(value: Decimal, places: Optional[int] = None) -> float:
    if places is not None:
        quant = Decimal("1." + ("0" * places))
        value = value.quantize(quant)
    return float(value)


def _get_project_supply(project: dict) -> Decimal:
    return _to_decimal(project.get("token_supply") or project.get("supply") or 0)


def _get_wallet_balance(supabase, project_id: str, wallet: str) -> Decimal:
    balance_res = (
        supabase.table("project_balances")
        .select("balance")
        .eq("project_id", project_id)
        .eq("wallet_address", wallet)
        .limit(1)
        .execute()
    )

    row = balance_res.data[0] if balance_res.data else None
    balance = _to_decimal(row.get("balance")) if row else Decimal("0")
    return max(balance, Decimal("0"))


def _get_total_circulating(supabase, project_id: str) -> Decimal:
    balances_res = (
        supabase.table("project_balances")
        .select("balance")
        .eq("project_id", project_id)
        .execute()
    )

    total = Decimal("0")
    for row in (balances_res.data or []):
        total += _to_decimal(row.get("balance"))

    return max(total, Decimal("0"))


def _get_market_row(supabase, project_id: str) -> dict:
    market_res = (
        supabase.table("project_market_state")
        .select("*")
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )

    if market_res.data:
        return market_res.data[0]

    return {
        "project_id": project_id,
        "price": float(DEFAULT_START_PRICE),
        "market_cap": 0,
        "circulating_supply": 0,
        "max_supply": 0,
        "volume_24h": 0,
        "last_trade_at": None,
    }


@router.get("/api/projects/{project_id}/market")
async def get_project_market(project_id: str):
    project_id = _resolve(project_id)
    return compute_market_snapshot(get_client(), project_id)


def compute_market_snapshot(supabase, project_id: str) -> dict:
    """Compute a project's market snapshot (price, market cap, volume).

    Extracted verbatim from the per-project GET endpoint so the batched
    /api/projects/discover endpoint can reuse the EXACT same math by
    looping this function server-side — no risk of divergence. Expects
    `project_id` to already be a canonical UUID (callers that take a
    slug-or-UUID path param must _resolve() first).
    """
    project_res = (
        supabase.table("projects")
        .select("id, token_supply, token_mint_address")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )

    project = project_res.data[0] if project_res.data else None
    max_supply = _get_project_supply(project or {})
    mint_address = (project or {}).get("token_mint_address")

    market = _get_market_row(supabase, project_id)
    price = _to_decimal(market.get("price") or DEFAULT_START_PRICE)
    circulating = _get_total_circulating(supabase, project_id)
    market_cap = price * circulating

    return {
        "project_id": project_id,
        "price": _decimal_to_float(price, 8),
        "market_cap": _decimal_to_float(market_cap, 4),
        "circulating_supply": _decimal_to_float(circulating, 6),
        "max_supply": _decimal_to_float(max_supply, 6),
        "volume_24h": float(market.get("volume_24h") or 0),
        "last_trade_at": market.get("last_trade_at"),
        # Honesty flags — price/volume/market_cap above are computed from
        # a DB-only ledger. For SIM_ mints this is a simulation, not an
        # on-chain market. Frontends MUST surface the simulated state.
        "is_simulated": is_simulated_token(mint_address),
        "token_mode": token_mode(mint_address),
        "simulation_mode": is_simulated_token(mint_address),
    }



@router.get("/api/projects/{project_id}/trades")
async def get_project_trades(project_id: str):
    project_id = _resolve(project_id)
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
    project_id = _resolve(project_id)
    supabase = get_client()
    balance = _get_wallet_balance(supabase, project_id, wallet)

    return {
        "project_id": project_id,
        "wallet": wallet,
        "balance": _decimal_to_float(balance, 6),
    }


@router.post("/api/projects/{project_id}/trade")
async def create_project_trade(project_id: str, body: TradeRequest):
    print(f"[trade] POST /trade: project={project_id}, side={body.side}, amount={body.amount}, wallet={body.wallet[:12]}...")
    supabase = get_client()

    try:
        project_res = (
            supabase.table("projects")
            .select("*")
            .eq("id", project_id)
            .single()
            .execute()
        )
    except Exception as db_err:
        print(f"[trade] DB ERROR fetching project: {type(db_err).__name__}: {db_err}")
        raise HTTPException(status_code=500, detail="Could not load the project. Please try again.")

    project = project_res.data
    if not project:
        print(f"[trade] Project not found: {project_id}")
        raise HTTPException(status_code=404, detail="Project not found")

    token_symbol = project.get("token_symbol")
    max_supply = _get_project_supply(project)
    mint_address = project.get("token_mint_address")
    trade_is_simulated = is_simulated_token(mint_address)

    if not token_symbol:
        raise HTTPException(status_code=400, detail="Project token symbol is missing")

    if max_supply <= 0:
        raise HTTPException(status_code=400, detail="Project supply is not configured")

    wallet = body.wallet.strip()
    if not wallet:
        raise HTTPException(status_code=400, detail="Wallet is required")

    side = body.side.lower()
    amount = _to_decimal(body.amount)

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    market = _get_market_row(supabase, project_id)
    current_price = _to_decimal(market.get("price") or DEFAULT_START_PRICE)
    if current_price <= 0:
        current_price = DEFAULT_START_PRICE

    current_balance = _get_wallet_balance(supabase, project_id, wallet)
    circulating = _get_total_circulating(supabase, project_id)
    remaining_supply = max_supply - circulating

    if side == "buy":
        if remaining_supply <= 0:
            raise HTTPException(status_code=400, detail="Sold out")

        if amount > remaining_supply:
            raise HTTPException(
                status_code=400,
                detail=f"Trade exceeds remaining supply. Remaining: {remaining_supply}"
            )
    elif side == "sell":
        if current_balance < amount:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient balance. Wallet holds {current_balance:.6f} {token_symbol}."
            )

    gross_value = current_price * amount
    total_fee = gross_value * Decimal(TOTAL_FEE_BPS) / Decimal("10000")
    project_fee = gross_value * Decimal(PROJECT_FEE_BPS) / Decimal("10000")
    dum_fee = gross_value * Decimal(DUM_FEE_BPS) / Decimal("10000")
    net_value = gross_value - total_fee

    price_impact = Decimal("0.0025") * (amount / Decimal("1000"))

    if side == "buy":
        new_price = current_price * (Decimal("1") + price_impact)
        new_balance = current_balance + amount
        new_circulating = circulating + amount
    else:
        new_price = current_price * (Decimal("1") - price_impact)
        if new_price < MIN_PRICE:
            new_price = MIN_PRICE
        new_balance = current_balance - amount
        new_circulating = circulating - amount
        if new_circulating < 0:
            new_circulating = Decimal("0")

    market_cap = new_price * new_circulating
    now = datetime.now(timezone.utc).isoformat()

    trade_insert = {
        "project_id": project_id,
        "token_symbol": token_symbol,
        "side": side,
        "amount": _decimal_to_float(amount, 6),
        "price": _decimal_to_float(current_price, 8),
        "gross_value": _decimal_to_float(gross_value, 6),
        "net_value": _decimal_to_float(net_value, 6),
        "project_fee": _decimal_to_float(project_fee, 6),
        "dum_fee": _decimal_to_float(dum_fee, 6),
        "created_at": now,
        "source": wallet,
    }

    # Per-trade side-effect diagnostics. These flags are surfaced in the
    # trade response so operators (and any future trade-integrity health
    # query) can see which sub-writes succeeded without having to read DB.
    side_effects = {
        "trade_inserted": False,
        "market_state_updated": False,
        "balance_updated": False,
        "candle_updated": False,
    }
    side_effect_errors: list[str] = []

    # 1. Insert trade row — critical, failure bubbles as 500
    try:
        trade_res = supabase.table("project_trades").insert(trade_insert).execute()
        side_effects["trade_inserted"] = True
        print(f"[trade] inserted project={project_id} side={side} amount={amount} id={trade_res.data[0]['id'] if trade_res.data else '?'}")
    except Exception as db_err:
        print(f"[trade] DB ERROR inserting trade project={project_id} side={side} amount={amount} err={type(db_err).__name__}: {db_err}")
        raise HTTPException(status_code=500, detail="Could not record the trade. Please try again.")

    market_upsert = {
        "project_id": project_id,
        "price": _decimal_to_float(new_price, 8),
        "market_cap": _decimal_to_float(market_cap, 4),
        "circulating_supply": _decimal_to_float(new_circulating, 6),
        "max_supply": _decimal_to_float(max_supply, 6),
        "volume_24h": round(float(market.get("volume_24h") or 0) + float(gross_value), 6),
        "last_trade_at": now,
        "updated_at": now,
    }

    # 2. Upsert market state — non-critical, log and continue so a trade
    # row is never orphaned just because the state table hiccupped.
    try:
        supabase.table("project_market_state").upsert(
            market_upsert,
            on_conflict="project_id"
        ).execute()
        side_effects["market_state_updated"] = True
        print(f"[trade] market_state upserted project={project_id} price={new_price} market_cap={market_cap}")
    except Exception as db_err:
        err_label = f"{type(db_err).__name__}"
        side_effect_errors.append(f"market_state:{err_label}")
        print(f"[trade] STATE DIVERGENCE project={project_id} sub=market_state err={err_label}: {db_err}")
        print(f"[trade] WARNING project={project_id}: trade row exists but market_state is stale")

    balance_upsert = {
        "wallet_address": wallet,
        "project_id": project_id,
        "token_symbol": token_symbol,
        "balance": _decimal_to_float(new_balance, 6),
        "updated_at": now,
    }

    # 3. Upsert wallet balance — non-critical, same pattern as market_state
    try:
        supabase.table("project_balances").upsert(
            balance_upsert,
            on_conflict="wallet_address,project_id"
        ).execute()
        side_effects["balance_updated"] = True
        print(f"[trade] balance upserted project={project_id} wallet={wallet[:12]}... balance={new_balance}")
    except Exception as db_err:
        err_label = f"{type(db_err).__name__}"
        side_effect_errors.append(f"balance:{err_label}")
        print(f"[trade] STATE DIVERGENCE project={project_id} sub=balance wallet={wallet[:12]}... err={err_label}: {db_err}")
        print(f"[trade] WARNING project={project_id}: trade row exists but balance is stale")

    # 4. Upsert candle data — non-critical, trade continues even on failure
    try:
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
                "open": _decimal_to_float(current_price, 8),
                "high": _decimal_to_float(max(current_price, new_price), 8),
                "low": _decimal_to_float(min(current_price, new_price), 8),
                "close": _decimal_to_float(new_price, 8),
                "volume": _decimal_to_float(gross_value, 6),
            }
            supabase.table("project_candles").insert(candle_insert).execute()
        else:
            candle_update = {
                "high": _decimal_to_float(
                    max(_to_decimal(existing_candle.get("high")), new_price), 8
                ),
                "low": _decimal_to_float(
                    min(_to_decimal(existing_candle.get("low")), new_price), 8
                ),
                "close": _decimal_to_float(new_price, 8),
                "volume": round(float(existing_candle.get("volume") or 0) + float(gross_value), 6),
            }
            supabase.table("project_candles").update(candle_update).eq(
                "id", existing_candle["id"]
            ).execute()
        side_effects["candle_updated"] = True
        print(f"[trade] candle upserted project={project_id} bucket={candle_time}")
    except Exception as candle_err:
        err_label = f"{type(candle_err).__name__}"
        side_effect_errors.append(f"candle:{err_label}")
        print(f"[trade] candle update error (non-critical) project={project_id} err={err_label}: {candle_err}")

    mode_label = "simulated_ledger" if trade_is_simulated else "on_chain"
    divergent = not all(side_effects.values())
    if divergent:
        print(f"[trade] ✓ trade complete ({mode_label}) project={project_id} side={side} amount={amount} — PARTIAL SIDE EFFECTS: {side_effect_errors}")
    else:
        print(f"[trade] ✓ trade complete ({mode_label}) project={project_id} side={side} amount={amount} @ {current_price} → new_price={new_price}")
    return {
        "status": "success",
        "trade": trade_res.data[0] if trade_res.data else trade_insert,
        "market": {
            "project_id": project_id,
            "price": _decimal_to_float(new_price, 8),
            "market_cap": _decimal_to_float(market_cap, 4),
            "circulating_supply": _decimal_to_float(new_circulating, 6),
            "max_supply": _decimal_to_float(max_supply, 6),
            "volume_24h": market_upsert["volume_24h"],
            "last_trade_at": now,
            "is_simulated": trade_is_simulated,
            "token_mode": token_mode(mint_address),
        },
        "balance": {
            "wallet": wallet,
            "balance": _decimal_to_float(new_balance, 6),
        },
        # Top-level honesty flags. Any caller consuming the trade response
        # can branch on these to label the trade as demo vs on-chain.
        "is_simulated": trade_is_simulated,
        "simulation_mode": trade_is_simulated,
        "token_mode": token_mode(mint_address),
        # Additive diagnostics. Every sub-write is reported here so callers
        # (and /api/health/trading) can tell which parts of the trade
        # actually landed. `state_divergent` is true if any non-critical
        # side write failed after the trade row was inserted.
        "side_effects": side_effects,
        "state_divergent": divergent,
        "side_effect_errors": side_effect_errors,
    }


@router.get("/api/projects/{project_id}/candles")
async def get_project_candles(project_id: str):
    project_id = _resolve(project_id)
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


@router.get("/api/activity/recent-trades")
async def get_recent_trades(limit: int = 48):
    """Latest trades across all projects (homepage activity ticker)."""
    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100

    supabase = get_client()

    trades_res = (
        supabase.table("project_trades")
        .select("id, project_id, side, price, token_symbol, amount, created_at")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    return {"trades": trades_res.data or []}

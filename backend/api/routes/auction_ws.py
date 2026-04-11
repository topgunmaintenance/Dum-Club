"""
Real-Time Auction WebSocket — server-authoritative auction state broadcast.

Replaces polling for auction state with real-time push.
Connected clients receive:
  - bid events
  - auction start/end events
  - synchronized timer ticks
  - host control events
"""
import asyncio
import json
import time
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from db.supabase import get_client

router = APIRouter()

# In-memory connection registry: project_id → set of WebSocket connections
_connections: Dict[str, Set[WebSocket]] = {}
_auction_timers: Dict[str, asyncio.Task] = {}


async def _broadcast(project_id: str, event: dict):
    """Broadcast an event to all connected clients for a project."""
    conns = _connections.get(project_id, set())
    msg = json.dumps(event)
    dead = set()
    for ws in conns:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    conns -= dead


async def broadcast_bid(project_id: str, bid_data: dict):
    """Broadcast a new bid to all connected clients."""
    await _broadcast(project_id, {
        "type": "bid",
        "data": bid_data,
        "timestamp": time.time(),
    })


async def broadcast_auction_event(project_id: str, event_type: str, data: dict):
    """Broadcast auction lifecycle events."""
    await _broadcast(project_id, {
        "type": event_type,  # auction_started, auction_ended, auction_tick
        "data": data,
        "timestamp": time.time(),
    })


async def _run_timer(project_id: str, auction_id: str, ends_at_epoch: float):
    """Server-authoritative countdown timer. Broadcasts ticks every second."""
    try:
        while True:
            remaining = ends_at_epoch - time.time()
            if remaining <= 0:
                # Timer expired — broadcast end event
                await _broadcast(project_id, {
                    "type": "auction_timer_expired",
                    "data": {"auction_id": auction_id, "remaining": 0},
                    "timestamp": time.time(),
                })
                print(f"[auction-ws] Timer expired for auction {auction_id}")
                break

            # Broadcast tick
            await _broadcast(project_id, {
                "type": "auction_tick",
                "data": {
                    "auction_id": auction_id,
                    "remaining_seconds": round(remaining, 1),
                },
                "timestamp": time.time(),
            })

            await asyncio.sleep(1.0)
    except asyncio.CancelledError:
        print(f"[auction-ws] Timer cancelled for auction {auction_id}")
    except Exception as exc:
        print(f"[auction-ws] Timer error: {exc!r}")


def start_auction_timer(project_id: str, auction_id: str, ends_at_epoch: float):
    """Start a server-side countdown for an auction."""
    # Cancel existing timer if any
    existing = _auction_timers.get(project_id)
    if existing and not existing.done():
        existing.cancel()

    task = asyncio.create_task(_run_timer(project_id, auction_id, ends_at_epoch))
    _auction_timers[project_id] = task
    print(f"[auction-ws] Timer started for auction {auction_id}, {ends_at_epoch - time.time():.0f}s remaining")


def stop_auction_timer(project_id: str):
    """Stop the auction timer for a project."""
    task = _auction_timers.pop(project_id, None)
    if task and not task.done():
        task.cancel()


@router.websocket("/events/{project_id}")
async def auction_events(websocket: WebSocket, project_id: str):
    """
    WebSocket for real-time auction events.
    Clients connect and receive push updates for bids, timers, and auction state.
    """
    await websocket.accept()
    print(f"[auction-ws] Client connected for project {project_id}")

    # Register connection
    if project_id not in _connections:
        _connections[project_id] = set()
    _connections[project_id].add(websocket)

    # Send current auction state on connect
    try:
        supabase = get_client()
        project_res = (
            supabase.table("projects")
            .select("active_auction_id")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        if project_res.data and project_res.data[0].get("active_auction_id"):
            auction_id = project_res.data[0]["active_auction_id"]
            auction_res = (
                supabase.table("auctions")
                .select("*")
                .eq("id", auction_id)
                .limit(1)
                .execute()
            )
            if auction_res.data:
                await websocket.send_text(json.dumps({
                    "type": "auction_state",
                    "data": auction_res.data[0],
                    "timestamp": time.time(),
                }))
    except Exception as exc:
        print(f"[auction-ws] Error sending initial state: {exc!r}")

    # Keep connection alive, handle client messages
    try:
        while True:
            # Client can send ping or bid requests
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong", "timestamp": time.time()}))
            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[auction-ws] Error: {exc!r}")
    finally:
        _connections.get(project_id, set()).discard(websocket)
        count = len(_connections.get(project_id, set()))
        print(f"[auction-ws] Client disconnected (project {project_id}, {count} remaining)")

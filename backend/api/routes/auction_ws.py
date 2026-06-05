"""
Real-Time Live WebSocket — chat, auction state, and event broadcast.

Connected clients receive:
  - chat messages (host + viewer)
  - bid events
  - auction start/end events
  - synchronized timer ticks
"""
import asyncio
import json
import time
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from db.supabase import get_client
from services.live_limits import check_chat_rate, check_stream_duration
from auth.privy import verify_privy_token

router = APIRouter()

_connections: Dict[str, Set[WebSocket]] = {}
_auction_timers: Dict[str, asyncio.Task] = {}
# Rate limit: track last message time per connection
_last_chat: Dict[int, float] = {}
# Per-connection authenticated identity: ws_id -> {"privy_id", "is_host"}.
# Set on connect from a verified ?token=. Anonymous viewers (no/invalid
# token) are absent → they can watch + receive events but cannot send chat.
_ws_auth: Dict[int, dict] = {}
# Host-issued chat bans per project: project_id -> set of banned privy_ids.
# In-memory, matching _connections' single-process broadcast model; a ban
# lasts the live session, which is the moderation window that matters.
_bans: Dict[str, Set[str]] = {}
MAX_CHAT_LENGTH = 300
CHAT_COOLDOWN = 0.5  # seconds between messages


def _resolve_is_host(supabase, project_id: str, privy_id: str) -> bool:
    """True if privy_id owns the project (3-strategy match, same as the
    HTTP owner checks). Used to grant verified 'host' role + moderation."""
    try:
        r = (
            supabase.table("projects")
            .select("owner_id, privy_id")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        if not r.data:
            return False
        p = r.data[0]
        if p.get("privy_id") and p["privy_id"] == privy_id:
            return True
        if p.get("owner_id"):
            if p["owner_id"] == privy_id:
                return True
            from api.routes.projects import _resolve_owner_uuid
            resolved = _resolve_owner_uuid(supabase, privy_id)
            return bool(resolved and p["owner_id"] == resolved)
        return False
    except Exception:
        return False


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


def broadcast_sync(project_id: str, event: dict):
    """Fire-and-forget broadcast from sync code (e.g. webhook handler)."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(_broadcast(project_id, event))
        else:
            loop.run_until_complete(_broadcast(project_id, event))
    except Exception as e:
        print(f"[live-ws] broadcast_sync failed: {e}")


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

    Accepts either a project UUID or slug as the path param. Frontend
    pages send whatever the URL has — /project/<slug> sends the slug,
    /embed/<slug> resolves to UUID first. Without normalization here,
    slug viewers and UUID viewers (and the broadcast_sync calls from
    process_order_paid which use offers.project_id, a UUID FK) all
    landed in DIFFERENT _connections buckets — so live inventory
    updates from a paid order never reached /project/<slug> viewers
    even though they were connected.

    Resolve to canonical UUID once on connect and key _connections,
    chat broadcasts, viewer counts, and the project lookup on it.
    """
    await websocket.accept()
    print(f"[auction-ws] Client connecting for project param={project_id}")

    # Normalize to canonical UUID. Falls back to the original input if
    # no project matches — preserves prior behavior for unknown projects
    # (clients still connect; backend never broadcasts to that key, so
    # they get a quiet, eventless connection — same as before this fix).
    from api.routes.projects import resolve_project_uuid
    resolved = resolve_project_uuid(get_client(), project_id)
    if resolved:
        if resolved != project_id:
            print(f"[auction-ws] Resolved {project_id} → {resolved}")
        project_id = resolved

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

    # Send viewer count on connect
    viewer_count = len(_connections.get(project_id, set()))
    await websocket.send_text(json.dumps({
        "type": "viewer_count",
        "data": {"count": viewer_count},
        "timestamp": time.time(),
    }))
    # Broadcast updated count to all
    await _broadcast(project_id, {
        "type": "viewer_count",
        "data": {"count": viewer_count},
        "timestamp": time.time(),
    })

    ws_id = id(websocket)

    # Authenticate this connection (optional). A valid Privy token in the
    # ?token= query param binds the socket to a real user id + host flag,
    # derived SERVER-SIDE so chat identity and the host badge can't be
    # spoofed. No/invalid token = anonymous viewer: can watch + receive
    # events, but can't send chat (gated in the chat handler below).
    _token = websocket.query_params.get("token")
    if _token:
        try:
            _claims = verify_privy_token(_token)
            _pid = _claims.get("sub")
            if _pid:
                _ws_auth[ws_id] = {
                    "privy_id": _pid,
                    "is_host": _resolve_is_host(get_client(), project_id, _pid),
                }
        except Exception as exc:
            print(f"[live-ws] token verify failed (guest): {type(exc).__name__}")

    # Keep connection alive, handle client messages
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type")

                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong", "timestamp": time.time()}))

                elif msg_type == "chat":
                    # Auth gate: only signed-in users can SEND. Identity is
                    # taken from the verified token, never from the client —
                    # this is what makes the host badge + bans trustworthy.
                    # Anonymous viewers can still watch; they just can't post.
                    auth = _ws_auth.get(ws_id)
                    if not auth:
                        await websocket.send_text(json.dumps({"type": "error", "data": {"message": "Sign in to chat."}}))
                        continue
                    sender_id = auth["privy_id"]

                    # Banned users can't post (ban is by verified user id, so
                    # a reconnect under a new socket can't evade it).
                    if sender_id in _bans.get(project_id, set()):
                        await websocket.send_text(json.dumps({"type": "error", "data": {"message": "You can no longer chat in this stream."}}))
                        continue

                    # Rate limit (per-connection cooldown + per-user sliding window)
                    now = time.time()
                    last = _last_chat.get(ws_id, 0)
                    if now - last < CHAT_COOLDOWN:
                        continue
                    _last_chat[ws_id] = now

                    rate_err = check_chat_rate(sender_id)
                    if rate_err:
                        await websocket.send_text(json.dumps({"type": "error", "data": {"message": rate_err}}))
                        continue

                    # Check stream duration — auto-end if exceeded
                    if check_stream_duration(project_id):
                        await _broadcast(project_id, {"type": "stream_expired", "data": {"message": "Stream duration limit reached"}, "timestamp": now})
                        break

                    body = (msg.get("body") or "").strip()
                    if not body or len(body) > MAX_CHAT_LENGTH:
                        continue

                    chat_event = {
                        "type": "chat",
                        "data": {
                            "id": f"msg-{now:.0f}-{ws_id}",
                            "project_id": project_id,
                            "sender_id": sender_id,
                            # Display name only — capped, not security-critical
                            # (the host badge comes from the verified role).
                            "sender_name": (msg.get("sender_name") or "Viewer")[:60],
                            "sender_role": "host" if auth.get("is_host") else "viewer",
                            "body": body,
                            "created_at": now,
                        },
                        "timestamp": now,
                    }
                    await _broadcast(project_id, chat_event)

                elif msg_type in ("ban", "unban"):
                    # Host-only moderation, by verified user id. Mute == ban
                    # for chat. Broadcast so every client hides/restores the
                    # target's messages immediately.
                    auth = _ws_auth.get(ws_id)
                    if not auth or not auth.get("is_host"):
                        continue
                    target = (msg.get("target_id") or "").strip()
                    if not target:
                        continue
                    if msg_type == "ban":
                        _bans.setdefault(project_id, set()).add(target)
                        await _broadcast(project_id, {"type": "user_banned", "data": {"target_id": target}, "timestamp": time.time()})
                    else:
                        _bans.get(project_id, set()).discard(target)
                        await _broadcast(project_id, {"type": "user_unbanned", "data": {"target_id": target}, "timestamp": time.time()})

            except json.JSONDecodeError:
                pass

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[live-ws] Error: {exc!r}")
    finally:
        _connections.get(project_id, set()).discard(websocket)
        _last_chat.pop(ws_id, None)
        _ws_auth.pop(ws_id, None)
        remaining = len(_connections.get(project_id, set()))
        print(f"[live-ws] Client disconnected (project {project_id}, {remaining} remaining)")
        # Broadcast updated viewer count
        await _broadcast(project_id, {
            "type": "viewer_count",
            "data": {"count": remaining},
            "timestamp": time.time(),
        })

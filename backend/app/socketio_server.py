"""Socket.IO server — processing status push."""

from __future__ import annotations

import socketio

from app.config import settings

# Async Socket.IO server with CORS matching FastAPI config
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)

# Track deal_id → set of session IDs for room management
_deal_rooms: dict[str, set[str]] = {}


@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None):
    """Client connected — no auth required at connect time (auth on join_deal)."""
    pass


@sio.event
async def disconnect(sid: str):
    """Clean up room tracking on disconnect."""
    for deal_id, sids in list(_deal_rooms.items()):
        sids.discard(sid)
        if not sids:
            del _deal_rooms[deal_id]


@sio.event
async def join_deal(sid: str, data: dict):
    """Client joins a deal room to receive processing updates.

    data = { "deal_id": "..." }
    """
    deal_id = data.get("deal_id")
    if not deal_id:
        return

    room = f"deal:{deal_id}"
    await sio.enter_room(sid, room)
    _deal_rooms.setdefault(deal_id, set()).add(sid)


@sio.event
async def leave_deal(sid: str, data: dict):
    """Client leaves a deal room."""
    deal_id = data.get("deal_id")
    if not deal_id:
        return

    room = f"deal:{deal_id}"
    await sio.leave_room(sid, room)
    sids = _deal_rooms.get(deal_id)
    if sids:
        sids.discard(sid)
        if not sids:
            del _deal_rooms[deal_id]


async def emit_processing_update(deal_id: str, data: dict):
    """Push a processing status update to all clients watching this deal."""
    room = f"deal:{deal_id}"
    await sio.emit("processing_update", data, room=room)

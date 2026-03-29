"""Chat endpoints — context retrieval, message persistence, session management."""

from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import get_current_user_id
from app.models.schemas import ApiResponse
from app.routers.deals import _resolve_user_id, _verify_deal_ownership

router = APIRouter()


# ── Request / Response schemas ───────────────────────────────────────────────

class ChatContextRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    session_id: Optional[str] = None
    top_k: int = Field(12, ge=1, le=30)


class SaveMessagesRequest(BaseModel):
    session_id: Optional[str] = None
    user_message: str = Field(..., min_length=1)
    assistant_message: str = Field(..., min_length=1)
    sources: Optional[list[dict]] = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/{deal_id}/chat/context")
async def chat_context(
    deal_id: uuid.UUID,
    body: ChatContextRequest,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Build RAG context with history-aware query condensation.

    1. Get/create a chat session
    2. Load previous messages for context
    3. Condense the query using conversation history
    4. Vector search with condensed query
    5. Return deal overview + relevant chunks + session_id
    """
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)

    from app.services.chat_engine import get_chat_context

    result = get_chat_context(
        deal_id=str(deal_id),
        user_id=str(user_id),
        query=body.query,
        session_id=body.session_id,
        top_k=body.top_k,
    )
    return ApiResponse.ok(result)


@router.post("/{deal_id}/chat/messages")
async def save_chat_messages(
    deal_id: uuid.UUID,
    body: SaveMessagesRequest,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Persist a user+assistant message pair after streaming completes.

    Creates a session on-the-fly if session_id is not provided.
    Sets the session title from the first user message.
    """
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)

    from app.services.chat_engine import (
        get_or_create_session,
        save_message,
        set_session_title,
    )
    from app.db.client import get_supabase

    sid = get_or_create_session(str(deal_id), str(user_id), body.session_id)

    # Check if session is new (no messages yet) → set title from first user msg
    sb = get_supabase()
    msg_count = (
        sb.table("chat_messages")
        .select("id", count="exact")
        .eq("session_id", sid)
        .execute()
    )
    is_new = (msg_count.count or 0) == 0

    # Save user message
    save_message(sid, "user", body.user_message)
    # Save assistant message with sources
    save_message(sid, "assistant", body.assistant_message, body.sources)

    # Title from first user message (truncated)
    if is_new:
        title = body.user_message[:200].strip()
        set_session_title(sid, title)

    return ApiResponse.ok({"session_id": sid})


@router.get("/{deal_id}/chat/sessions")
async def list_chat_sessions(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """List all chat sessions for this deal, newest first."""
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)

    from app.services.chat_engine import list_sessions

    sessions = list_sessions(str(deal_id), str(user_id))
    return ApiResponse.ok(sessions)


@router.get("/{deal_id}/chat/sessions/{session_id}/messages")
async def get_chat_messages(
    deal_id: uuid.UUID,
    session_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Load all messages for a chat session (with ownership verification)."""
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)

    from app.services.chat_engine import get_session_messages

    messages = get_session_messages(str(session_id), str(deal_id), str(user_id))
    return ApiResponse.ok(messages)

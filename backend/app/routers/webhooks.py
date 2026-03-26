"""Clerk webhook handler — user sync (Phase 7)."""

from __future__ import annotations

from fastapi import APIRouter, Request, HTTPException

from app.db.client import get_supabase
from app.models.schemas import ApiResponse

router = APIRouter()


@router.post("/clerk")
async def clerk_webhook(request: Request):
    """Handle Clerk webhook events for user lifecycle.

    Events handled:
    - user.created → insert into users table
    - user.updated → update users table
    - user.deleted → delete from users table

    Note: In production, verify the Svix signature header.
    See https://clerk.com/docs/integrations/webhooks
    """
    body = await request.json()
    event_type = body.get("type", "")
    data = body.get("data", {})

    sb = get_supabase()

    if event_type == "user.created":
        clerk_id = data.get("id")
        email = ""
        email_addresses = data.get("email_addresses", [])
        if email_addresses:
            email = email_addresses[0].get("email_address", "")
        name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()

        sb.table("users").upsert({
            "clerk_user_id": clerk_id,
            "email": email,
            "name": name or None,
        }, on_conflict="clerk_user_id").execute()

    elif event_type == "user.updated":
        clerk_id = data.get("id")
        email = ""
        email_addresses = data.get("email_addresses", [])
        if email_addresses:
            email = email_addresses[0].get("email_address", "")
        name = f"{data.get('first_name', '')} {data.get('last_name', '')}".strip()

        sb.table("users").update({
            "email": email,
            "name": name or None,
        }).eq("clerk_user_id", clerk_id).execute()

    elif event_type == "user.deleted":
        clerk_id = data.get("id")
        if clerk_id:
            sb.table("users").delete().eq("clerk_user_id", clerk_id).execute()

    return ApiResponse.ok({"status": "ok"})

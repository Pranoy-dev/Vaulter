"""Company classifications CRUD endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user_id
from app.db.client import get_supabase
from app.models.schemas import (
    ApiResponse,
    ClassificationCreate,
    ClassificationUpdate,
)

router = APIRouter()


def _resolve_company_id(clerk_user_id: str) -> uuid.UUID:
    """Get the company_id for the current user."""
    sb = get_supabase()
    result = sb.table("users").select("company_id").eq("clerk_user_id", clerk_user_id).execute()
    if not result.data or not result.data[0].get("company_id"):
        raise HTTPException(status_code=404, detail="No company associated with this user")
    return uuid.UUID(result.data[0]["company_id"])


@router.get("")
async def list_classifications(clerk_user_id: str = Depends(get_current_user_id)):
    """List all classifications for the user's company.

    If the user has no company yet (pre-migration user), backfills it inline
    so classifications are always returned on the first call.
    """
    sb = get_supabase()
    user_row = sb.table("users").select("id, company_id").eq("clerk_user_id", clerk_user_id).execute()
    if not user_row.data:
        return ApiResponse.ok({"classifications": []})

    user = user_row.data[0]
    company_id = user.get("company_id")

    if not company_id:
        # Backfill company inline — runs for users created before the company feature
        from app.auth import _backfill_company
        await _backfill_company(clerk_user_id, user["id"])
        # Re-read the now-populated company_id
        refreshed = sb.table("users").select("company_id").eq("clerk_user_id", clerk_user_id).execute()
        if refreshed.data:
            company_id = refreshed.data[0].get("company_id")

    if not company_id:
        return ApiResponse.ok({"classifications": []})

    result = (
        sb.table("company_classifications")
        .select("*")
        .eq("company_id", company_id)
        .order("display_order")
        .execute()
    )
    return ApiResponse.ok({"classifications": result.data})


@router.post("", status_code=201)
async def create_classification(
    body: ClassificationCreate,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Add a new classification to the user's company."""
    company_id = _resolve_company_id(clerk_user_id)
    sb = get_supabase()

    # Check for duplicate key within this company
    existing = (
        sb.table("company_classifications")
        .select("id")
        .eq("company_id", str(company_id))
        .eq("key", body.key)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail=f"Classification key '{body.key}' already exists")

    result = sb.table("company_classifications").insert({
        "company_id": str(company_id),
        "key": body.key,
        "label": body.label,
        "description": body.description,
        "display_order": body.display_order,
    }).execute()
    return ApiResponse.ok(result.data[0])


@router.put("/{classification_id}")
async def update_classification(
    classification_id: uuid.UUID,
    body: ClassificationUpdate,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Update a classification (label, description, order, active status)."""
    company_id = _resolve_company_id(clerk_user_id)
    sb = get_supabase()

    # Verify ownership
    existing = (
        sb.table("company_classifications")
        .select("id")
        .eq("id", str(classification_id))
        .eq("company_id", str(company_id))
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Classification not found")

    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = (
        sb.table("company_classifications")
        .update(update_data)
        .eq("id", str(classification_id))
        .execute()
    )
    return ApiResponse.ok(result.data[0])


@router.delete("/{classification_id}")
async def delete_classification(
    classification_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Remove a classification from the user's company."""
    company_id = _resolve_company_id(clerk_user_id)
    sb = get_supabase()

    # Verify ownership
    existing = (
        sb.table("company_classifications")
        .select("id, key")
        .eq("id", str(classification_id))
        .eq("company_id", str(company_id))
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Classification not found")

    sb.table("company_classifications").delete().eq("id", str(classification_id)).execute()
    return ApiResponse.ok({"deleted": str(classification_id)})

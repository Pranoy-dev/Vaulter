"""Deals CRUD + overview endpoints (Phase 3 + Phase 5)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import get_current_user_id
from app.db.client import get_supabase
from app.models.schemas import (
    ApiResponse,
    DealCreate,
    DealListResponse,
    DealResponse,
    DocumentListResponse,
    DocumentResponse,
    DuplicateGroupListResponse,
    DuplicateGroupMemberResponse,
    DuplicateGroupResponse,
    LeaseChainDocumentResponse,
    LeaseChainListResponse,
    LeaseChainResponse,
)

router = APIRouter()


def _resolve_user_id(clerk_user_id: str) -> uuid.UUID:
    """Lookup internal user UUID from Clerk user ID, creating if needed."""
    sb = get_supabase()
    result = sb.table("users").select("id").eq("clerk_user_id", clerk_user_id).execute()
    if result.data:
        return uuid.UUID(result.data[0]["id"])
    # Auto-create user row on first deal action
    insert = sb.table("users").insert({"clerk_user_id": clerk_user_id, "email": ""}).execute()
    return uuid.UUID(insert.data[0]["id"])


def _verify_deal_ownership(deal_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Fetch deal and verify the user owns it."""
    sb = get_supabase()
    result = sb.table("deals").select("*").eq("id", str(deal_id)).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Deal not found")
    if result.data["user_id"] != str(user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return result.data


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=DealResponse, status_code=201)
async def create_deal(body: DealCreate, clerk_user_id: str = Depends(get_current_user_id)):
    user_id = _resolve_user_id(clerk_user_id)
    sb = get_supabase()
    result = sb.table("deals").insert({
        "user_id": str(user_id),
        "name": body.name,
    }).execute()
    return ApiResponse.ok(result.data[0])


@router.get("", response_model=DealListResponse)
async def list_deals(clerk_user_id: str = Depends(get_current_user_id)):
    user_id = _resolve_user_id(clerk_user_id)
    sb = get_supabase()
    result = (
        sb.table("deals")
        .select("*")
        .eq("user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return ApiResponse.ok({"deals": result.data})


@router.get("/{deal_id}")
async def get_deal(deal_id: uuid.UUID, clerk_user_id: str = Depends(get_current_user_id)):
    user_id = _resolve_user_id(clerk_user_id)
    deal = _verify_deal_ownership(deal_id, user_id)
    return ApiResponse.ok(deal)


# ── Documents (Phase 5) ─────────────────────────────────────────────────────

@router.get("/{deal_id}/documents", response_model=DocumentListResponse)
async def list_documents(
    deal_id: uuid.UUID,
    category: str | None = None,
    search: str | None = None,
    clerk_user_id: str = Depends(get_current_user_id),
):
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)
    sb = get_supabase()
    query = sb.table("documents").select("*", count="exact").eq("deal_id", str(deal_id))
    if category:
        query = query.eq("assigned_category", category)
    if search:
        query = query.ilike("filename", f"%{search}%")
    result = query.order("original_path").execute()
    return ApiResponse.ok({"documents": result.data, "total": result.count or len(result.data)})


@router.get("/{deal_id}/documents/{doc_id}/download")
async def download_document(
    deal_id: uuid.UUID,
    doc_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)
    sb = get_supabase()
    doc = sb.table("documents").select("storage_path").eq("id", str(doc_id)).single().execute()
    if not doc.data or not doc.data.get("storage_path"):
        raise HTTPException(status_code=404, detail="Document not found")
    signed = sb.storage.from_("dataroom-files").create_signed_url(doc.data["storage_path"], 3600)
    return ApiResponse.ok({"url": signed.get("signedURL") or signed.get("signedUrl")})


# ── Duplicates (Phase 5) ────────────────────────────────────────────────────

@router.get("/{deal_id}/duplicates", response_model=DuplicateGroupListResponse)
async def list_duplicates(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)
    sb = get_supabase()
    groups = (
        sb.table("duplicate_groups")
        .select("*")
        .eq("deal_id", str(deal_id))
        .execute()
    )
    result = []
    for g in groups.data:
        members = (
            sb.table("duplicate_group_members")
            .select("*, documents(filename, original_path)")
            .eq("group_id", g["id"])
            .execute()
        )
        member_list = []
        for m in members.data:
            doc_info = m.get("documents") or {}
            member_list.append(DuplicateGroupMemberResponse(
                id=m["id"],
                document_id=m["document_id"],
                is_canonical=m["is_canonical"],
                filename=doc_info.get("filename"),
                original_path=doc_info.get("original_path"),
            ))
        result.append(DuplicateGroupResponse(
            id=g["id"],
            group_name=g["group_name"],
            match_type=g["match_type"],
            members=member_list,
        ))
    # Sort by group size descending
    result.sort(key=lambda g: len(g.members), reverse=True)
    return ApiResponse.ok({"groups": result})


# ── Lease Chains (Phase 5) ──────────────────────────────────────────────────

@router.get("/{deal_id}/lease-chains", response_model=LeaseChainListResponse)
async def list_lease_chains(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)
    sb = get_supabase()
    chains = (
        sb.table("lease_chains")
        .select("*")
        .eq("deal_id", str(deal_id))
        .execute()
    )
    result = []
    for c in chains.data:
        docs = (
            sb.table("lease_chain_documents")
            .select("*, documents(filename, original_path)")
            .eq("chain_id", c["id"])
            .order("amendment_number", desc=False)
            .execute()
        )
        doc_list = []
        for d in docs.data:
            doc_info = d.get("documents") or {}
            doc_list.append(LeaseChainDocumentResponse(
                id=d["id"],
                document_id=d["document_id"],
                doc_type=d["doc_type"],
                amendment_number=d.get("amendment_number"),
                is_orphaned=d["is_orphaned"],
                filename=doc_info.get("filename"),
                original_path=doc_info.get("original_path"),
            ))
        result.append(LeaseChainResponse(
            id=c["id"],
            tenant_name=c["tenant_name"],
            tenant_identifier=c.get("tenant_identifier"),
            documents=doc_list,
        ))
    return ApiResponse.ok({"chains": result})

"""Deals CRUD + overview endpoints (Phase 3 + Phase 5)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.db.client import get_supabase
from app.models.schemas import (
    ApiResponse,
    DealCreate,
    DuplicateGroupMemberResponse,
    DuplicateGroupResponse,
    LeaseChainDocumentResponse,
    LeaseChainResponse,
)

router = APIRouter()


def _resolve_user_id(clerk_user_id: str) -> uuid.UUID:
    """Lookup internal user UUID from Clerk user ID."""
    sb = get_supabase()
    result = sb.table("users").select("id").eq("clerk_user_id", clerk_user_id).execute()
    if result.data:
        return uuid.UUID(result.data[0]["id"])
    # Fallback: upsert so we never violate the unique constraint
    upsert = sb.table("users").upsert(
        {"clerk_user_id": clerk_user_id, "email": ""},
        on_conflict="clerk_user_id",
    ).execute()
    return uuid.UUID(upsert.data[0]["id"])


def _resolve_company_id(clerk_user_id: str) -> str | None:
    """Lookup company_id for a Clerk user. Returns string UUID or None."""
    sb = get_supabase()
    result = sb.table("users").select("company_id").eq("clerk_user_id", clerk_user_id).execute()
    if result.data and result.data[0].get("company_id"):
        return result.data[0]["company_id"]
    return None


def _verify_deal_ownership(deal_id: uuid.UUID, user_id: uuid.UUID) -> dict:
    """Fetch deal and verify the user owns it."""
    sb = get_supabase()
    result = sb.table("deals").select("*").eq("id", str(deal_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Deal not found")
    if result.data[0]["user_id"] != str(user_id):
        raise HTTPException(status_code=403, detail="Access denied")
    return result.data[0]


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_deal(body: DealCreate, clerk_user_id: str = Depends(get_current_user_id)):
    try:
        user_id = _resolve_user_id(clerk_user_id)
        company_id = _resolve_company_id(clerk_user_id)
        sb = get_supabase()

        # Reject duplicate project names for this user (case-insensitive)
        existing = (
            sb.table("deals")
            .select("id")
            .eq("user_id", str(user_id))
            .ilike("name", body.name.strip())
            .execute()
        )
        if existing.data:
            raise HTTPException(status_code=409, detail=f'A project named "{body.name.strip()}" already exists.')

        insert_data: dict = {
            "user_id": str(user_id),
            "name": body.name.strip(),
        }
        if body.description is not None:
            insert_data["description"] = body.description.strip() or None
        if company_id:
            insert_data["company_id"] = company_id
        result = sb.table("deals").insert(insert_data).execute()
        return ApiResponse.ok(result.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("")
async def list_deals(clerk_user_id: str = Depends(get_current_user_id)):
    try:
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
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/{deal_id}")
async def get_deal(deal_id: uuid.UUID, clerk_user_id: str = Depends(get_current_user_id)):
    try:
        user_id = _resolve_user_id(clerk_user_id)
        deal = _verify_deal_ownership(deal_id, user_id)
        return ApiResponse.ok(deal)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── Documents (Phase 5) ─────────────────────────────────────────────────────

@router.get("/{deal_id}/documents")
async def list_documents(
    deal_id: uuid.UUID,
    category: str | None = None,
    search: str | None = None,
    clerk_user_id: str = Depends(get_current_user_id),
):
    try:
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
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/{deal_id}/documents/{doc_id}/download")
async def download_document(
    deal_id: uuid.UUID,
    doc_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    try:
        user_id = _resolve_user_id(clerk_user_id)
        _verify_deal_ownership(deal_id, user_id)
        sb = get_supabase()
        doc = sb.table("documents").select("storage_path").eq("id", str(doc_id)).execute()
        if not doc.data or not doc.data[0].get("storage_path"):
            raise HTTPException(status_code=404, detail="Document not found")
        signed = sb.storage.from_("dataroom-files").create_signed_url(doc.data[0]["storage_path"], 3600)
        return ApiResponse.ok({"url": signed.get("signedURL") or signed.get("signedUrl")})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── Duplicates (Phase 5) ────────────────────────────────────────────────────

@router.get("/{deal_id}/duplicates")
async def list_duplicates(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    try:
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
                .select("*, documents(filename, original_path, file_size)")
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
                    similarity_score=m.get("similarity_score"),
                    filename=doc_info.get("filename"),
                    original_path=doc_info.get("original_path"),
                    file_size=doc_info.get("file_size"),
                ))
            result.append(DuplicateGroupResponse(
                id=g["id"],
                group_name=g["group_name"],
                match_type=g["match_type"],
                members=member_list,
            ))
        # Sort by group size descending, exclude groups with fewer than 2 members
        result = [g for g in result if len(g.members) >= 2]
        result.sort(key=lambda g: len(g.members), reverse=True)
        return ApiResponse.ok({"groups": result})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── Lease Chains (Phase 5) ──────────────────────────────────────────────────

@router.get("/{deal_id}/lease-chains")
async def list_lease_chains(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    try:
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
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── Delete Deal ─────────────────────────────────────────────────────────────

@router.delete("/{deal_id}", status_code=200)
async def delete_deal(deal_id: uuid.UUID, clerk_user_id: str = Depends(get_current_user_id)):
    try:
        user_id = _resolve_user_id(clerk_user_id)
        _verify_deal_ownership(deal_id, user_id)
        sb = get_supabase()

        # Collect all storage paths from documents before deleting the deal row.
        # (Storage paths are date-prefixed like YYYY/MM/{deal_id}/... so we can't
        # reliably list them from Storage directly — fetch from DB instead.)
        try:
            doc_rows = (
                sb.table("documents")
                .select("storage_path")
                .eq("deal_id", str(deal_id))
                .not_.is_("storage_path", "null")
                .execute()
            ).data or []
            paths = [r["storage_path"] for r in doc_rows if r.get("storage_path")]
            if paths:
                # Supabase Storage remove accepts up to 1000 paths per call
                for i in range(0, len(paths), 1000):
                    sb.storage.from_("dataroom-files").remove(paths[i : i + 1000])
        except Exception:
            pass  # Storage cleanup is best-effort; DB delete still proceeds

        # Delete the deal row — cascades to:
        #   documents → document_chunks (embeddings live here) → (gone)
        #   document_chunks via deal_id FK → (gone)
        #   chat_sessions → chat_messages → (gone)
        #   duplicate_groups, lease_chains, processing_job → (gone)
        sb.table("deals").delete().eq("id", str(deal_id)).execute()

        return ApiResponse.ok({"deleted": str(deal_id)})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── Delete Document ──────────────────────────────────────────────────────────

@router.delete("/{deal_id}/documents/{doc_id}", status_code=200)
async def delete_document(
    deal_id: uuid.UUID,
    doc_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    try:
        user_id = _resolve_user_id(clerk_user_id)
        _verify_deal_ownership(deal_id, user_id)
        sb = get_supabase()

        doc = sb.table("documents").select("storage_path").eq("id", str(doc_id)).eq("deal_id", str(deal_id)).execute()
        if not doc.data:
            raise HTTPException(status_code=404, detail="Document not found")

        # Delete storage file
        storage_path = doc.data[0].get("storage_path")
        if storage_path:
            try:
                sb.storage.from_("dataroom-files").remove([storage_path])
            except Exception:
                pass  # Best-effort; DB delete still proceeds

        # Explicitly delete chunks + embeddings before the document row.
        # FK cascade handles this, but being explicit ensures it works even
        # if RLS policies on document_chunks interfere with the cascade.
        sb.table("document_chunks").delete().eq("document_id", str(doc_id)).execute()

        # Delete the document row — cascades to extraction_segments etc.
        sb.table("documents").delete().eq("id", str(doc_id)).execute()
        return ApiResponse.ok({"deleted": str(doc_id)})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── Move Document (rename original_path / virtual folder) ───────────────────

class MoveDocumentBody(BaseModel):
    new_folder: str  # Target folder path, e.g. "FolderA/SubFolder" or "" for root


@router.patch("/{deal_id}/documents/{doc_id}/move", status_code=200)
async def move_document(
    deal_id: uuid.UUID,
    doc_id: uuid.UUID,
    body: MoveDocumentBody,
    clerk_user_id: str = Depends(get_current_user_id),
):
    try:
        user_id = _resolve_user_id(clerk_user_id)
        _verify_deal_ownership(deal_id, user_id)
        sb = get_supabase()

        doc = (
            sb.table("documents")
            .select("id, filename, original_path")
            .eq("id", str(doc_id))
            .eq("deal_id", str(deal_id))
            .execute()
        )
        if not doc.data:
            raise HTTPException(status_code=404, detail="Document not found")

        filename = doc.data[0]["filename"]
        folder = body.new_folder.strip("/")
        new_path = f"{folder}/{filename}" if folder else filename

        sb.table("documents").update({"original_path": new_path}).eq("id", str(doc_id)).execute()
        return ApiResponse.ok({"id": str(doc_id), "original_path": new_path})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

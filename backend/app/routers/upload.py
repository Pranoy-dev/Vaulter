"""File upload endpoint (Phase 3)."""

from __future__ import annotations

import hashlib
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from app.auth import get_current_user_id
from app.db.client import get_supabase
from app.models.schemas import ApiResponse, UploadCompleteResponse
from app.services.storage import upload_file

router = APIRouter()

ACCEPTED_EXTENSIONS = {
    ".pdf", ".docx", ".xlsx", ".pptx", ".msg", ".eml",
    ".png", ".jpg", ".jpeg", ".gif", ".tiff", ".bmp",
}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB


@router.post("/{deal_id}/upload", response_model=UploadCompleteResponse)
async def upload_files(
    deal_id: uuid.UUID,
    files: list[UploadFile] = File(...),
    paths: list[str] = Form(default=[]),
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Upload multiple files to a deal, preserving folder structure via `paths`."""
    sb = get_supabase()

    # Verify deal exists and user owns it
    from app.routers.deals import _resolve_user_id, _verify_deal_ownership
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)

    # Update deal status
    sb.table("deals").update({"status": "uploading"}).eq("id", str(deal_id)).execute()

    total_size = 0
    uploaded_count = 0

    for i, file in enumerate(files):
        # Use provided relative path or fall back to filename
        relative_path = paths[i] if i < len(paths) else (file.filename or f"file_{i}")
        filename = os.path.basename(relative_path)
        ext = os.path.splitext(filename)[1].lower()

        # Validate extension
        if ext and ext not in ACCEPTED_EXTENSIONS:
            continue  # Skip unsupported files silently

        content = await file.read()
        file_size = len(content)
        total_size += file_size

        if total_size > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Upload exceeds 5 GB limit")

        # SHA-256 hash
        sha256 = hashlib.sha256(content).hexdigest()

        # Upload to storage
        content_type = file.content_type or "application/octet-stream"
        storage_path = upload_file(str(deal_id), relative_path, content, content_type)

        # Insert document metadata
        sb.table("documents").insert({
            "deal_id": str(deal_id),
            "original_path": relative_path,
            "filename": filename,
            "file_extension": ext or None,
            "file_type": content_type,
            "file_size": file_size,
            "sha256_hash": sha256,
            "storage_path": storage_path,
        }).execute()

        uploaded_count += 1

    # Update deal
    sb.table("deals").update({
        "status": "uploaded",
        "file_count": uploaded_count,
        "total_size": total_size,
    }).eq("id", str(deal_id)).execute()

    # Create a pending processing job
    sb.table("processing_jobs").insert({
        "deal_id": str(deal_id),
        "status": "pending",
    }).execute()

    return ApiResponse.ok(UploadCompleteResponse(
        deal_id=deal_id,
        files_uploaded=uploaded_count,
        total_size=total_size,
    ).model_dump())

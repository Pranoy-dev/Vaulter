"""Chunked / resumable file-upload endpoints.

Flow
----
1. ``POST /{deal_id}/upload/init``       → start session, get ``session_id`` + recommended chunk size
2. ``POST /{deal_id}/upload/chunk``      → send one chunk  (multipart form)
3. ``GET  /{deal_id}/upload/progress``   → query which chunks are already stored (for resume)
4. ``POST /{deal_id}/upload/complete``   → assemble chunks → Supabase Storage → DB records
"""

from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import os
import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File

from app.auth import get_current_user_id
from app.config import settings
from app.db.client import get_supabase
from app.models.schemas import (
    ApiResponse,
    ChunkUploadResponse,
    FileProgress,
    UploadCompleteResponse,
    UploadInitResponse,
    UploadProgressResponse,
)
from app.services.storage import (
    assemble_file,
    cleanup_session,
    get_session_files,
    get_uploaded_chunks,
    save_chunk,
    upload_file,
)

router = APIRouter()

ACCEPTED_EXTENSIONS = {
    ".pdf", ".docx", ".xlsx", ".pptx", ".msg", ".eml",
    ".png", ".jpg", ".jpeg", ".gif", ".tiff", ".bmp", ".webp", ".heic", ".heif",
    ".txt", ".csv", ".html", ".htm", ".xml", ".rtf", ".md", ".json",
}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB per deal

_MIME_MAP: dict[str, str] = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".msg":  "application/vnd.ms-outlook",
    ".eml":  "message/rfc822",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".tiff": "application/pdf",
    ".bmp":  "application/pdf",
    ".webp": "application/pdf",
    ".heic": "application/pdf",
    ".heif": "application/pdf",
    ".txt":  "text/plain",
    ".csv":  "text/csv",
    ".html": "text/html",
    ".htm":  "text/html",
    ".xml":  "text/xml",
    ".rtf":  "text/rtf",
    ".md":   "text/plain",
    ".json": "application/json",
}


# ── helpers ──────────────────────────────────────────────────────────────────

def _verify_ownership(deal_id: uuid.UUID, clerk_user_id: str):
    from app.routers.deals import _resolve_user_id, _verify_deal_ownership
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)


# ── 1. Initialise upload session ─────────────────────────────────────────────

@router.post("/{deal_id}/upload/init")
async def upload_init(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Create a new upload session for a deal.  Returns session_id + chunk_size."""
    try:
        _verify_ownership(deal_id, clerk_user_id)

        session_id = uuid.uuid4().hex
        sb = get_supabase()
        sb.table("deals").update({"status": "uploading"}).eq("id", str(deal_id)).execute()

        return ApiResponse.ok(
            UploadInitResponse(
                session_id=session_id,
                deal_id=deal_id,
                chunk_size=settings.upload_chunk_size,
            ).model_dump()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── 2. Receive one chunk ─────────────────────────────────────────────────────

@router.post("/{deal_id}/upload/chunk")
async def upload_chunk(
    deal_id: uuid.UUID,
    session_id: str = Form(...),
    relative_path: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    file_size: int = Form(...),
    chunk: UploadFile = File(...),
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Store a single chunk on disk.  Lightweight — no Supabase write yet."""
    try:
        _verify_ownership(deal_id, clerk_user_id)

        # Skip unsupported file types silently — frontend already filters these,
        # but guard here in case a direct API call is made.
        ext = os.path.splitext(relative_path)[1].lower()
        if ext and ext not in ACCEPTED_EXTENSIONS:
            return ApiResponse.ok(
                ChunkUploadResponse(
                    relative_path=relative_path,
                    chunk_index=chunk_index,
                    chunks_received=0,
                    total_chunks=total_chunks,
                ).model_dump()
            )
        if chunk_index < 0 or chunk_index >= total_chunks:
            raise HTTPException(status_code=422, detail="Invalid chunk_index")

        data = await chunk.read()

        chunks_received = save_chunk(
            deal_id=str(deal_id),
            session_id=session_id,
            relative_path=relative_path,
            chunk_index=chunk_index,
            data=data,
            total_chunks=total_chunks,
            file_size=file_size,
        )

        return ApiResponse.ok(
            ChunkUploadResponse(
                relative_path=relative_path,
                chunk_index=chunk_index,
                chunks_received=chunks_received,
                total_chunks=total_chunks,
            ).model_dump()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── 3. Resume helper – query session progress ────────────────────────────────

@router.get("/{deal_id}/upload/progress")
async def upload_progress(
    deal_id: uuid.UUID,
    session_id: str,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Return per-file chunk status so the client can resume."""
    try:
        _verify_ownership(deal_id, clerk_user_id)

        files = get_session_files(str(deal_id), session_id)

        return ApiResponse.ok(
            UploadProgressResponse(
                deal_id=deal_id,
                session_id=session_id,
                files=[
                    FileProgress(
                        relative_path=f["relative_path"],
                        file_size=f["file_size"],
                        total_chunks=f["total_chunks"],
                        uploaded_chunks=f["uploaded_chunks"],
                    )
                    for f in files
                ],
            ).model_dump()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


# ── 4. Finalise — assemble, hash, push to Supabase, create DB rows ──────────

@router.post("/{deal_id}/upload/complete")
async def upload_complete(
    deal_id: uuid.UUID,
    session_id: str = Form(...),
    skipped_files: str = Form(default="[]"),
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Assemble every file from its chunks, upload to Supabase Storage, and insert document rows."""
    import json
    import logging
    logger = logging.getLogger(__name__)

    try:
        _verify_ownership(deal_id, clerk_user_id)

        sb = get_supabase()
        files = get_session_files(str(deal_id), session_id)

        if not files:
            raise HTTPException(status_code=422, detail="No files found in this session")

        total_size = 0
        uploaded_count = 0
        failed_files: list[dict] = []

        for fmeta in files:
            relative_path: str = fmeta["relative_path"]
            total_chunks: int = fmeta["total_chunks"]
            received = fmeta["uploaded_chunks"]

            # Ensure every chunk is present
            if len(received) != total_chunks:
                missing = set(range(total_chunks)) - set(received)
                failed_files.append({"path": relative_path, "error": f"Missing chunks: {sorted(missing)}"})
                continue

            try:
                # Assemble
                content, size = assemble_file(str(deal_id), session_id, relative_path)
                total_size += size

                if total_size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Upload exceeds 5 GB limit")

                sha256 = hashlib.sha256(content).hexdigest()
                filename = os.path.basename(relative_path)
                ext = os.path.splitext(filename)[1].lower() or None
                content_type = (
                    _MIME_MAP.get(ext or "")
                    or mimetypes.guess_type(filename)[0]
                    or "application/pdf"
                )

                # Push to Supabase Storage (date-prefixed path)
                storage_path = upload_file(str(deal_id), relative_path, content, content_type)

                # Upsert document — resets all processing fields if file already exists
                sb.table("documents").upsert({
                    "deal_id": str(deal_id),
                    "original_path": relative_path,
                    "filename": filename,
                    "file_extension": ext,
                    "file_type": content_type,
                    "file_size": size,
                    "sha256_hash": sha256,
                    "storage_path": storage_path,
                    "rag_indexed": False,
                    "rag_indexed_at": None,
                    "assigned_category": "other",
                    "classification_confidence": 0,
                    "classification_reasoning": None,
                    "extracted_text": None,
                    "is_incomplete": False,
                    "incompleteness_reasons": None,
                    "is_empty": False,
                    "processing_status": "pending",
                    "processing_error": None,
                    "classified_at": None,
                }, on_conflict="deal_id,original_path").execute()
                uploaded_count += 1
            except HTTPException:
                raise
            except Exception as file_exc:
                logger.warning("Failed to upload %s: %s", relative_path, file_exc)
                failed_files.append({"path": relative_path, "error": str(file_exc)})
                continue

        # Parse skipped files JSON (sent by client)
        try:
            skipped_list = json.loads(skipped_files) if skipped_files else []
            if not isinstance(skipped_list, list):
                skipped_list = []
        except Exception:
            skipped_list = []

        # Append server-side failures to skipped list
        for ff in failed_files:
            skipped_list.append(f"{ff['path']} (upload error: {ff['error']})")

        # Update deal counters
        sb.table("deals").update({
            "status": "uploaded",
            "file_count": uploaded_count,
            "total_size": total_size,
            "skipped_files": skipped_list,
        }).eq("id", str(deal_id)).execute()

        # Upsert processing job — handles re-uploads to the same deal
        sb.table("processing_jobs").upsert({
            "deal_id": str(deal_id),
            "status": "pending",
            "current_stage": "indexing",
            "progress": 0,
            "error_message": None,
            "started_at": None,
            "completed_at": None,
        }, on_conflict="deal_id").execute()

        # Clean up temp chunks
        cleanup_session(str(deal_id), session_id)

        return ApiResponse.ok(
            UploadCompleteResponse(
                deal_id=deal_id,
                files_uploaded=uploaded_count,
                total_size=total_size,
            ).model_dump()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.post("/{deal_id}/upload/detect-duplicates")
async def detect_duplicates_after_upload(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Trigger hash-based duplicate detection for a deal.

    Called by the frontend immediately after /upload/complete so the
    user sees it as an explicit step. Hashes are already stored in the
    DB during assembly, so this is a fast DB-only operation.
    """
    _verify_ownership(deal_id, clerk_user_id)
    try:
        from app.services.duplicate_detection import detect_hash_duplicates
        groups_found = await asyncio.to_thread(detect_hash_duplicates, str(deal_id))
        return ApiResponse.ok({"groups_found": groups_found})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc

"""Processing pipeline — trigger + status endpoint (Phase 4)."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth import get_current_user_id
from app.db.client import get_supabase
from app.models.schemas import ApiResponse, ProcessingJobResponse
from app.routers.deals import _resolve_user_id, _verify_deal_ownership
from app.socketio_server import emit_processing_update

router = APIRouter()

# In-memory tracking of running jobs (for v1 — single-instance deployment)
_running_jobs: dict[str, asyncio.Task] = {}


async def _update_job(deal_id: str, *, status: str | None = None, stage: str | None = None,
                progress: float | None = None, error: str | None = None,
                started: bool = False, completed: bool = False,
                sub_stage: str | None = None, stage_detail: str | None = None,
                current_file: str | None = None,
                ai_detail: str | None = None, rag_detail: str | None = None):
    """Update the processing_jobs row and push via Socket.IO."""
    sb = get_supabase()
    update: dict = {}
    if status:
        update["status"] = status
    if stage:
        update["current_stage"] = stage
    if progress is not None:
        update["progress"] = progress
    if error is not None:
        update["error_message"] = error
    if started:
        update["started_at"] = datetime.now(timezone.utc).isoformat()
    if completed:
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
    if update:
        sb.table("processing_jobs").update(update).eq("deal_id", deal_id).execute()

    # Push real-time update via Socket.IO
    await emit_processing_update(deal_id, {
        "status": status,
        "current_stage": stage,
        "progress": progress,
        "error_message": error,
        "sub_stage": sub_stage,
        "stage_detail": stage_detail,
        "current_file": current_file,
        "ai_detail": ai_detail,
        "rag_detail": rag_detail,
    })


async def _run_pipeline(deal_id: str):
    """Execute the 3-stage processing pipeline sequentially."""
    sb = get_supabase()

    try:
        # Update deal status
        sb.table("deals").update({"status": "processing"}).eq("id", deal_id).execute()
        await _update_job(deal_id, status="running", stage="indexing", progress=0, started=True)

        # Stage 1: Indexing (already done during upload — just mark progress)
        await asyncio.sleep(0.5)  # Small pause for UX
        await _update_job(deal_id, progress=0.05)

        # Stage 2: Hash-based duplicate detection (fast, pre-AI)
        await _update_job(deal_id, stage="detecting_hash_duplicates", progress=0.06)
        from app.services.duplicate_detection import detect_hash_duplicates, detect_content_duplicates
        await asyncio.to_thread(detect_hash_duplicates, deal_id)
        await _update_job(deal_id, progress=0.10)

        # Stage 3: Document Processing (Gemini extraction + classification + completeness)
        await _update_job(deal_id, stage="document_processing", progress=0.12)
        from app.services.gemini_processor import process_deal_documents

        loop = asyncio.get_running_loop()

        def _progress_cb(payload: dict) -> None:
            """Sync callback invoked from the processing thread."""
            sub_stage = payload.get("sub_stage", "")
            ai_current = payload.get("ai_current", 0)
            ai_total = payload.get("ai_total", 1)
            rag_current = payload.get("rag_current", 0)
            rag_total = payload.get("rag_total", 1)
            filename = payload.get("filename", "")

            # Map combined AI+RAG progress into the 0.12 – 0.50 range
            ai_frac = ai_current / ai_total if ai_total > 0 else 0.0
            rag_frac = rag_current / rag_total if rag_total > 0 else 0.0
            overall = 0.12 + (ai_frac * 0.6 + rag_frac * 0.4) * 0.38  # 0.12 → 0.50

            ai_detail = f"{ai_current}/{ai_total}"
            rag_detail = f"{rag_current}/{rag_total}"

            asyncio.run_coroutine_threadsafe(
                _update_job(
                    deal_id,
                    progress=round(overall, 3),
                    sub_stage=sub_stage,
                    stage_detail=ai_detail,   # kept for backward compat
                    current_file=filename,
                    ai_detail=ai_detail,
                    rag_detail=rag_detail,
                ),
                loop,
            )

        await asyncio.to_thread(process_deal_documents, deal_id, _progress_cb)
        await _update_job(deal_id, progress=0.50, sub_stage=None, stage_detail=None, current_file=None)

        # Stage 4: Content-based duplicate detection (post-AI, with similarity %)
        await _update_job(deal_id, stage="detecting_duplicates", progress=0.52)
        await asyncio.to_thread(detect_content_duplicates, deal_id)
        await _update_job(deal_id, progress=0.70)

        # Stage 4: Lease & Amendment Linking
        await _update_job(deal_id, stage="linking_documents", progress=0.72)
        from app.services.lease_linker import link_leases
        await asyncio.to_thread(link_leases, deal_id)
        await _update_job(deal_id, progress=0.85)

        # Stage 5: Building overview — compute AI insights & deal scoring
        await _update_job(deal_id, stage="building_overview", progress=0.90)
        from app.services.deal_insights import compute_deal_insights
        await asyncio.to_thread(compute_deal_insights, deal_id)
        await _update_job(deal_id, stage="done", progress=1.0, status="completed", completed=True)

        sb.table("deals").update({"status": "completed"}).eq("id", deal_id).execute()

    except Exception as exc:
        await _update_job(deal_id, status="failed", error=str(exc))
        sb.table("deals").update({"status": "failed"}).eq("id", deal_id).execute()
    finally:
        _running_jobs.pop(deal_id, None)


@router.post("/{deal_id}/process")
async def trigger_processing(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Trigger the processing pipeline for a deal."""
    try:
        user_id = _resolve_user_id(clerk_user_id)
        _verify_deal_ownership(deal_id, user_id)

        deal_id_str = str(deal_id)
        sb = get_supabase()

        # Check for existing job
        job = (
            sb.table("processing_jobs")
            .select("*")
            .eq("deal_id", deal_id_str)
            .execute()
        )
        if not job.data:
            raise HTTPException(status_code=400, detail="No processing job found — upload files first")
        job_row = job.data[0]
        # Allow re-triggering if the DB says "running" but no active in-memory task exists
        # (e.g. server was restarted mid-run, leaving a stale "running" state in the DB)
        if job_row["status"] == "running" and deal_id_str in _running_jobs:
            raise HTTPException(status_code=409, detail="Processing already in progress")

        # Reset job if re-running
        sb.table("processing_jobs").update({
            "status": "pending",
            "current_stage": "indexing",
            "progress": 0,
            "error_message": None,
            "started_at": None,
            "completed_at": None,
        }).eq("deal_id", deal_id_str).execute()

        # Start async task
        task = asyncio.create_task(_run_pipeline(deal_id_str))
        _running_jobs[deal_id_str] = task

        # Re-fetch updated job
        result = (
            sb.table("processing_jobs")
            .select("*")
            .eq("deal_id", deal_id_str)
            .execute()
        )
        return ApiResponse.ok(result.data[0])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/{deal_id}/process/status")
async def processing_status_sse(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """SSE endpoint for real-time processing progress."""
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)
    deal_id_str = str(deal_id)

    async def event_stream():
        sb = get_supabase()
        while True:
            job = (
                sb.table("processing_jobs")
                .select("*")
                .eq("deal_id", deal_id_str)
                .execute()
            )
            if not job.data:
                yield f"data: {json.dumps({'error': 'Job not found'})}\n\n"
                return

            data = {
                "status": job.data[0]["status"],
                "current_stage": job.data[0].get("current_stage"),
                "progress": job.data[0].get("progress", 0),
                "error_message": job.data[0].get("error_message"),
            }
            yield f"data: {json.dumps(data)}\n\n"

            if job.data[0]["status"] in ("completed", "failed"):
                return

            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{deal_id}/process")
async def get_processing_status(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Get the current processing job status."""
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)
    sb = get_supabase()
    result = (
        sb.table("processing_jobs")
        .select("*")
        .eq("deal_id", str(deal_id))
        .execute()
    )
    if not result.data:
        # No job yet — return null data so the client knows quietly
        return ApiResponse.ok(None)
    return ApiResponse.ok(result.data[0])

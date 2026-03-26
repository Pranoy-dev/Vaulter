"""Processing pipeline — trigger + SSE status endpoint (Phase 4)."""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth import get_current_user_id
from app.db.client import get_supabase
from app.models.schemas import ProcessingJobResponse
from app.routers.deals import _resolve_user_id, _verify_deal_ownership

router = APIRouter()

# In-memory tracking of running jobs (for v1 — single-instance deployment)
_running_jobs: dict[str, asyncio.Task] = {}


def _update_job(deal_id: str, *, status: str | None = None, stage: str | None = None,
                progress: float | None = None, error: str | None = None,
                started: bool = False, completed: bool = False):
    """Update the processing_jobs row."""
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


async def _run_pipeline(deal_id: str):
    """Execute the 3-stage processing pipeline sequentially."""
    sb = get_supabase()

    try:
        # Update deal status
        sb.table("deals").update({"status": "processing"}).eq("id", deal_id).execute()
        _update_job(deal_id, status="running", stage="indexing", progress=0, started=True)

        # Stage 1: Indexing (already done during upload — just mark progress)
        await asyncio.sleep(0.5)  # Small pause for UX
        _update_job(deal_id, progress=0.10)

        # Stage 2: Duplicate Detection
        _update_job(deal_id, stage="detecting_duplicates", progress=0.15)
        from app.services.duplicate_detection import detect_duplicates
        await asyncio.to_thread(detect_duplicates, deal_id)
        _update_job(deal_id, progress=0.40)

        # Stage 3: Document Classification (run before lease linking — it sets categories)
        _update_job(deal_id, stage="linking_documents", progress=0.45)
        from app.services.document_classifier import classify_documents
        await asyncio.to_thread(classify_documents, deal_id)
        _update_job(deal_id, progress=0.65)

        # Stage 4: Lease & Amendment Linking
        from app.services.lease_linker import link_leases
        await asyncio.to_thread(link_leases, deal_id)
        _update_job(deal_id, progress=0.85)

        # Stage 5: Building overview (compute summary stats)
        _update_job(deal_id, stage="building_overview", progress=0.90)
        await asyncio.sleep(0.3)
        _update_job(deal_id, stage="done", progress=1.0, status="completed", completed=True)

        sb.table("deals").update({"status": "completed"}).eq("id", deal_id).execute()

    except Exception as exc:
        _update_job(deal_id, status="failed", error=str(exc))
        sb.table("deals").update({"status": "failed"}).eq("id", deal_id).execute()
    finally:
        _running_jobs.pop(deal_id, None)


@router.post("/{deal_id}/process", response_model=ProcessingJobResponse)
async def trigger_processing(
    deal_id: uuid.UUID,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Trigger the processing pipeline for a deal."""
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)

    deal_id_str = str(deal_id)
    sb = get_supabase()

    # Check for existing job
    job = (
        sb.table("processing_jobs")
        .select("*")
        .eq("deal_id", deal_id_str)
        .single()
        .execute()
    )
    if not job.data:
        raise HTTPException(status_code=400, detail="No processing job found — upload files first")
    if job.data["status"] == "running":
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
        .single()
        .execute()
    )
    return result.data


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
                .single()
                .execute()
            )
            if not job.data:
                yield f"data: {json.dumps({'error': 'Job not found'})}\n\n"
                return

            data = {
                "status": job.data["status"],
                "current_stage": job.data.get("current_stage"),
                "progress": job.data.get("progress", 0),
                "error_message": job.data.get("error_message"),
            }
            yield f"data: {json.dumps(data)}\n\n"

            if job.data["status"] in ("completed", "failed"):
                return

            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{deal_id}/process", response_model=ProcessingJobResponse)
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
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="No processing job found")
    return result.data

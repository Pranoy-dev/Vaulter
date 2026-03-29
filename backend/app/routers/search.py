"""RAG chunk-search endpoint — used by the chat to retrieve relevant context."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import get_current_user_id
from app.models.schemas import ApiResponse
from app.routers.deals import _resolve_user_id, _verify_deal_ownership

router = APIRouter()


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(8, ge=1, le=20)


@router.post("/{deal_id}/search")
async def search_deal_chunks(
    deal_id: uuid.UUID,
    body: SearchRequest,
    clerk_user_id: str = Depends(get_current_user_id),
):
    """Embed the query and return the top-k most relevant chunk texts for a deal.

    The chat frontend calls this to build the RAG context window before sending
    the user message to the LLM.
    """
    user_id = _resolve_user_id(clerk_user_id)
    _verify_deal_ownership(deal_id, user_id)

    from app.services.embeddings import search_chunks

    results = search_chunks(
        query=body.query,
        deal_id=str(deal_id),
        top_k=body.top_k,
    )
    return ApiResponse.ok(results)

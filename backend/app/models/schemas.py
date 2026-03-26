"""Pydantic models for API request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


# ── Enums ────────────────────────────────────────────────────────────────────

class DealStatus(str, Enum):
    created = "created"
    uploading = "uploading"
    uploaded = "uploaded"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class DocumentCategory(str, Enum):
    leases_amendments = "leases_amendments"
    financial = "financial"
    technical_environmental = "technical_environmental"
    corporate_legal = "corporate_legal"
    other = "other"


class MatchType(str, Enum):
    exact = "exact"
    near = "near"


class LeaseDocType(str, Enum):
    base_lease = "base_lease"
    amendment = "amendment"
    side_letter = "side_letter"
    correspondence = "correspondence"
    unknown = "unknown"


class ProcessingStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ProcessingStage(str, Enum):
    indexing = "indexing"
    detecting_duplicates = "detecting_duplicates"
    linking_documents = "linking_documents"
    building_overview = "building_overview"
    done = "done"


# ── Deals ────────────────────────────────────────────────────────────────────

class DealCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class DealResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    status: DealStatus
    file_count: int
    total_size: int
    created_at: datetime
    updated_at: datetime


class DealListResponse(BaseModel):
    deals: list[DealResponse]


# ── Documents ────────────────────────────────────────────────────────────────

class DocumentResponse(BaseModel):
    id: uuid.UUID
    deal_id: uuid.UUID
    original_path: str
    filename: str
    file_extension: str | None
    file_type: str | None
    file_size: int
    assigned_category: DocumentCategory
    classification_confidence: float
    created_at: datetime


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]
    total: int


# ── Duplicates ───────────────────────────────────────────────────────────────

class DuplicateGroupMemberResponse(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    is_canonical: bool
    # Joined fields
    filename: str | None = None
    original_path: str | None = None


class DuplicateGroupResponse(BaseModel):
    id: uuid.UUID
    group_name: str
    match_type: MatchType
    members: list[DuplicateGroupMemberResponse]


class DuplicateGroupListResponse(BaseModel):
    groups: list[DuplicateGroupResponse]


# ── Lease Chains ─────────────────────────────────────────────────────────────

class LeaseChainDocumentResponse(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    doc_type: LeaseDocType
    amendment_number: int | None
    is_orphaned: bool
    # Joined fields
    filename: str | None = None
    original_path: str | None = None


class LeaseChainResponse(BaseModel):
    id: uuid.UUID
    tenant_name: str
    tenant_identifier: str | None
    documents: list[LeaseChainDocumentResponse]


class LeaseChainListResponse(BaseModel):
    chains: list[LeaseChainResponse]


# ── Processing ───────────────────────────────────────────────────────────────

class ProcessingJobResponse(BaseModel):
    id: uuid.UUID
    deal_id: uuid.UUID
    status: ProcessingStatus
    current_stage: ProcessingStage | None
    progress: float
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None


# ── Upload ───────────────────────────────────────────────────────────────────

class UploadCompleteResponse(BaseModel):
    deal_id: uuid.UUID
    files_uploaded: int
    total_size: int


# ── Clerk Webhook ────────────────────────────────────────────────────────────

class ClerkWebhookPayload(BaseModel):
    data: dict
    type: str

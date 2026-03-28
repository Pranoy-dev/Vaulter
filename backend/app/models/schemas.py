"""Pydantic models for API request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


# ── Common Response Wrapper ──────────────────────────────────────────────────

class ErrorDetail(BaseModel):
    code: str
    message: str

class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: T | None = None
    error: ErrorDetail | None = None

    @classmethod
    def ok(cls, data: T) -> "ApiResponse[T]":
        return cls(success=True, data=data)

    @classmethod
    def fail(cls, code: str, message: str) -> "ApiResponse[None]":
        return cls(success=False, error=ErrorDetail(code=code, message=message))


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
    document_processing = "document_processing"
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
    assigned_category: str | None
    classification_confidence: float
    classification_reasoning: str | None = None
    is_incomplete: bool = False
    incompleteness_reasons: list[str] | None = None
    is_empty: bool = False
    processing_status: str = "pending"
    processing_error: str | None = None
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
    file_size: int | None = None


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

class UploadInitResponse(BaseModel):
    session_id: str
    deal_id: uuid.UUID
    chunk_size: int


class ChunkUploadResponse(BaseModel):
    relative_path: str
    chunk_index: int
    chunks_received: int
    total_chunks: int


class FileProgress(BaseModel):
    relative_path: str
    file_size: int
    total_chunks: int
    uploaded_chunks: list[int]


class UploadProgressResponse(BaseModel):
    deal_id: uuid.UUID
    session_id: str
    files: list[FileProgress]


class UploadCompleteResponse(BaseModel):
    deal_id: uuid.UUID
    files_uploaded: int
    total_size: int


# ── Clerk Webhook ────────────────────────────────────────────────────────────

class ClerkWebhookPayload(BaseModel):
    data: dict
    type: str


# ── Companies ────────────────────────────────────────────────────────────────

class CompanyResponse(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime
    updated_at: datetime


# ── Classifications ──────────────────────────────────────────────────────────

class ClassificationResponse(BaseModel):
    id: uuid.UUID
    company_id: uuid.UUID
    key: str
    label: str
    description: str | None
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ClassificationListResponse(BaseModel):
    classifications: list[ClassificationResponse]


class ClassificationCreate(BaseModel):
    key: str = Field(..., min_length=1, max_length=100)
    label: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    display_order: int = 0


class ClassificationUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    display_order: int | None = None
    is_active: bool | None = None

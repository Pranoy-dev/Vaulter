"""SQLAlchemy ORM models — mirrors backend/db/schema.sql."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    BigInteger,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# ── COMPANIES ────────────────────────────────────────────────────────────────

class Company(Base):
    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    users = relationship("User", back_populates="company", cascade="all, delete-orphan")
    deals = relationship("Deal", back_populates="company", cascade="all, delete-orphan")
    classifications = relationship("CompanyClassification", back_populates="company", cascade="all, delete-orphan")


# ── COMPANY CLASSIFICATIONS ─────────────────────────────────────────────────

class CompanyClassification(Base):
    __tablename__ = "company_classifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    key = Column(Text, nullable=False)
    label = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    display_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    company = relationship("Company", back_populates="classifications")

    __table_args__ = (
        UniqueConstraint("company_id", "key", name="uq_company_classification_key"),
        Index("idx_classifications_company", "company_id"),
    )


# ── USERS ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clerk_user_id = Column(Text, unique=True, nullable=False)
    email = Column(Text, nullable=False)
    name = Column(Text)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    company = relationship("Company", back_populates="users")
    deals = relationship("Deal", back_populates="user", cascade="all, delete-orphan")


# ── DEALS ────────────────────────────────────────────────────────────────────

class Deal(Base):
    __tablename__ = "deals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)
    name = Column(Text, nullable=False)
    status = Column(
        Enum("created", "uploading", "uploaded", "processing", "completed", "failed",
             name="deal_status", create_type=True),
        nullable=False,
        server_default="created",
    )
    file_count = Column(Integer, default=0)
    total_size = Column(BigInteger, default=0)
    skipped_files = Column(JSONB, nullable=True, default=list)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="deals")
    company = relationship("Company", back_populates="deals")
    documents = relationship("Document", back_populates="deal", cascade="all, delete-orphan")
    duplicate_groups = relationship("DuplicateGroup", back_populates="deal", cascade="all, delete-orphan")
    lease_chains = relationship("LeaseChain", back_populates="deal", cascade="all, delete-orphan")
    processing_job = relationship("ProcessingJob", back_populates="deal", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_deals_user", "user_id"),
        Index("idx_deals_company", "company_id"),
    )


# ── DOCUMENTS ────────────────────────────────────────────────────────────────

class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deal_id = Column(UUID(as_uuid=True), ForeignKey("deals.id", ondelete="CASCADE"), nullable=False)
    original_path = Column(Text, nullable=False)
    filename = Column(Text, nullable=False)
    file_extension = Column(Text)
    file_type = Column(Text)
    file_size = Column(BigInteger, default=0)
    sha256_hash = Column(Text)
    storage_path = Column(Text)
    assigned_category = Column(Text, server_default="other")
    classification_confidence = Column(Float, default=0)
    classification_reasoning = Column(Text, nullable=True)
    extracted_text = Column(Text, nullable=True)
    is_incomplete = Column(Boolean, nullable=False, default=False)
    incompleteness_reasons = Column(JSONB, nullable=True)
    processing_status = Column(Text, nullable=False, server_default="pending")
    processing_error = Column(Text, nullable=True)
    rag_indexed = Column(Boolean, nullable=False, default=False)
    rag_indexed_at = Column(DateTime(timezone=True), nullable=True)
    classified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    deal = relationship("Deal", back_populates="documents")
    extraction_segments = relationship("ExtractionSegment", back_populates="document", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_documents_deal", "deal_id"),
        Index("idx_documents_hash", "sha256_hash"),
        Index("idx_documents_category", "deal_id", "assigned_category"),
    )


# ── EXTRACTION SEGMENTS (large PDF resumability) ─────────────────────────────

class ExtractionSegment(Base):
    __tablename__ = "extraction_segments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    segment_index = Column(Integer, nullable=False)
    page_start = Column(Integer, nullable=False)
    page_end = Column(Integer, nullable=False)
    gemini_file_uri = Column(Text, nullable=True)
    status = Column(Text, nullable=False, server_default="pending")
    extracted_text = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    document = relationship("Document", back_populates="extraction_segments")

    __table_args__ = (
        Index("idx_extraction_segments_doc", "document_id"),
    )


# ── DUPLICATE GROUPS ─────────────────────────────────────────────────────────

class DuplicateGroup(Base):
    __tablename__ = "duplicate_groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deal_id = Column(UUID(as_uuid=True), ForeignKey("deals.id", ondelete="CASCADE"), nullable=False)
    group_name = Column(Text, nullable=False)
    match_type = Column(
        Enum("exact", "near", name="match_type", create_type=True),
        nullable=False,
        server_default="exact",
    )
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    deal = relationship("Deal", back_populates="duplicate_groups")
    members = relationship("DuplicateGroupMember", back_populates="group", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_dup_groups_deal", "deal_id"),
    )


class DuplicateGroupMember(Base):
    __tablename__ = "duplicate_group_members"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("duplicate_groups.id", ondelete="CASCADE"), nullable=False)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    is_canonical = Column(Boolean, default=False)

    group = relationship("DuplicateGroup", back_populates="members")

    __table_args__ = (
        Index("idx_dup_members_group", "group_id"),
    )


# ── LEASE CHAINS ─────────────────────────────────────────────────────────────

class LeaseChain(Base):
    __tablename__ = "lease_chains"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deal_id = Column(UUID(as_uuid=True), ForeignKey("deals.id", ondelete="CASCADE"), nullable=False)
    tenant_name = Column(Text, nullable=False)
    tenant_identifier = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    deal = relationship("Deal", back_populates="lease_chains")
    documents = relationship("LeaseChainDocument", back_populates="chain", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_lease_chains_deal", "deal_id"),
    )


class LeaseChainDocument(Base):
    __tablename__ = "lease_chain_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chain_id = Column(UUID(as_uuid=True), ForeignKey("lease_chains.id", ondelete="CASCADE"), nullable=False)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    doc_type = Column(
        Enum("base_lease", "amendment", "side_letter", "correspondence", "unknown",
             name="lease_doc_type", create_type=True),
        nullable=False,
        server_default="unknown",
    )
    amendment_number = Column(Integer)
    is_orphaned = Column(Boolean, default=False)

    chain = relationship("LeaseChain", back_populates="documents")

    __table_args__ = (
        Index("idx_chain_docs_chain", "chain_id"),
    )


# ── PROCESSING JOBS ──────────────────────────────────────────────────────────

class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    deal_id = Column(UUID(as_uuid=True), ForeignKey("deals.id", ondelete="CASCADE"), unique=True, nullable=False)
    status = Column(
        Enum("pending", "running", "completed", "failed",
             name="processing_status", create_type=True),
        nullable=False,
        server_default="pending",
    )
    current_stage = Column(
        Enum("indexing", "document_processing", "detecting_duplicates", "linking_documents", "building_overview", "done",
             name="processing_stage", create_type=True),
        server_default="indexing",
    )
    progress = Column(Float, default=0)
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    deal = relationship("Deal", back_populates="processing_job")

    __table_args__ = (
        Index("idx_processing_deal", "deal_id"),
    )


# ── EMBEDDINGS (pgvector — v2) ───────────────────────────────────────────────
# Note: The vector column type requires pgvector extension.
# Alembic will create the table structure; the vector column is added via
# raw SQL in the migration to avoid requiring pgvector locally.

class Embedding(Base):
    __tablename__ = "embeddings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunk_index = Column(Integer, nullable=False, default=0)
    chunk_text = Column(Text, nullable=False)
    # embedding column (vector(1536)) added via raw SQL in migration
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_embeddings_doc", "document_id"),
    )

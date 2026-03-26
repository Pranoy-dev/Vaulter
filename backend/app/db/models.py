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
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# ── USERS ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clerk_user_id = Column(Text, unique=True, nullable=False)
    email = Column(Text, nullable=False)
    name = Column(Text)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    deals = relationship("Deal", back_populates="user", cascade="all, delete-orphan")


# ── DEALS ────────────────────────────────────────────────────────────────────

class Deal(Base):
    __tablename__ = "deals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(Text, nullable=False)
    status = Column(
        Enum("created", "uploading", "uploaded", "processing", "completed", "failed",
             name="deal_status", create_type=True),
        nullable=False,
        server_default="created",
    )
    file_count = Column(Integer, default=0)
    total_size = Column(BigInteger, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="deals")
    documents = relationship("Document", back_populates="deal", cascade="all, delete-orphan")
    duplicate_groups = relationship("DuplicateGroup", back_populates="deal", cascade="all, delete-orphan")
    lease_chains = relationship("LeaseChain", back_populates="deal", cascade="all, delete-orphan")
    processing_job = relationship("ProcessingJob", back_populates="deal", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_deals_user", "user_id"),
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
    assigned_category = Column(
        Enum("leases_amendments", "financial", "technical_environmental", "corporate_legal", "other",
             name="document_category", create_type=True),
        server_default="other",
    )
    classification_confidence = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    deal = relationship("Deal", back_populates="documents")

    __table_args__ = (
        Index("idx_documents_deal", "deal_id"),
        Index("idx_documents_hash", "sha256_hash"),
        Index("idx_documents_category", "deal_id", "assigned_category"),
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
        Enum("indexing", "detecting_duplicates", "linking_documents", "building_overview", "done",
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

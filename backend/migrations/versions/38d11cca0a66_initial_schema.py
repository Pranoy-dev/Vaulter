"""initial_schema

Revision ID: 38d11cca0a66
Revises: 
Create Date: 2026-03-26 10:13:05.000011

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = '38d11cca0a66'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all tables for the DataRoom AI Platform."""

    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Enums
    deal_status = sa.Enum(
        "created", "uploading", "uploaded", "processing", "completed", "failed",
        name="deal_status",
    )
    document_category = sa.Enum(
        "leases_amendments", "financial", "technical_environmental", "corporate_legal", "other",
        name="document_category",
    )
    match_type = sa.Enum("exact", "near", name="match_type")
    lease_doc_type = sa.Enum(
        "base_lease", "amendment", "side_letter", "correspondence", "unknown",
        name="lease_doc_type",
    )
    processing_status = sa.Enum("pending", "running", "completed", "failed", name="processing_status")
    processing_stage = sa.Enum(
        "indexing", "detecting_duplicates", "linking_documents", "building_overview", "done",
        name="processing_stage",
    )

    # ── users ────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("clerk_user_id", sa.Text, unique=True, nullable=False),
        sa.Column("email", sa.Text, nullable=False),
        sa.Column("name", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_users_clerk", "users", ["clerk_user_id"])

    # ── deals ────────────────────────────────────────────────────────────
    op.create_table(
        "deals",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("status", deal_status, nullable=False, server_default="created"),
        sa.Column("file_count", sa.Integer, server_default="0"),
        sa.Column("total_size", sa.BigInteger, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_deals_user", "deals", ["user_id"])

    # ── documents ────────────────────────────────────────────────────────
    op.create_table(
        "documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("deal_id", UUID(as_uuid=True), sa.ForeignKey("deals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("original_path", sa.Text, nullable=False),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("file_extension", sa.Text),
        sa.Column("file_type", sa.Text),
        sa.Column("file_size", sa.BigInteger, server_default="0"),
        sa.Column("sha256_hash", sa.Text),
        sa.Column("storage_path", sa.Text),
        sa.Column("assigned_category", document_category, server_default="other"),
        sa.Column("classification_confidence", sa.Float, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_documents_deal", "documents", ["deal_id"])
    op.create_index("idx_documents_hash", "documents", ["sha256_hash"])
    op.create_index("idx_documents_category", "documents", ["deal_id", "assigned_category"])

    # ── duplicate_groups ─────────────────────────────────────────────────
    op.create_table(
        "duplicate_groups",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("deal_id", UUID(as_uuid=True), sa.ForeignKey("deals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_name", sa.Text, nullable=False),
        sa.Column("match_type", match_type, nullable=False, server_default="exact"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_dup_groups_deal", "duplicate_groups", ["deal_id"])

    # ── duplicate_group_members ──────────────────────────────────────────
    op.create_table(
        "duplicate_group_members",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("group_id", UUID(as_uuid=True), sa.ForeignKey("duplicate_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_canonical", sa.Boolean, server_default="false"),
    )
    op.create_index("idx_dup_members_group", "duplicate_group_members", ["group_id"])

    # ── lease_chains ─────────────────────────────────────────────────────
    op.create_table(
        "lease_chains",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("deal_id", UUID(as_uuid=True), sa.ForeignKey("deals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_name", sa.Text, nullable=False),
        sa.Column("tenant_identifier", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_lease_chains_deal", "lease_chains", ["deal_id"])

    # ── lease_chain_documents ────────────────────────────────────────────
    op.create_table(
        "lease_chain_documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("chain_id", UUID(as_uuid=True), sa.ForeignKey("lease_chains.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("doc_type", lease_doc_type, nullable=False, server_default="unknown"),
        sa.Column("amendment_number", sa.Integer),
        sa.Column("is_orphaned", sa.Boolean, server_default="false"),
    )
    op.create_index("idx_chain_docs_chain", "lease_chain_documents", ["chain_id"])

    # ── processing_jobs ──────────────────────────────────────────────────
    op.create_table(
        "processing_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("deal_id", UUID(as_uuid=True), sa.ForeignKey("deals.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("status", processing_status, nullable=False, server_default="pending"),
        sa.Column("current_stage", processing_stage, server_default="indexing"),
        sa.Column("progress", sa.Float, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("error_message", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_processing_deal", "processing_jobs", ["deal_id"])

    # ── embeddings (pgvector) ────────────────────────────────────────────
    op.create_table(
        "embeddings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("chunk_text", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    # Add vector column via raw SQL (requires pgvector extension)
    op.execute("ALTER TABLE embeddings ADD COLUMN embedding vector(1536)")
    op.create_index("idx_embeddings_doc", "embeddings", ["document_id"])

    # ── Row Level Security ───────────────────────────────────────────────
    for table in [
        "users", "deals", "documents", "duplicate_groups",
        "duplicate_group_members", "lease_chains",
        "lease_chain_documents", "processing_jobs", "embeddings",
    ]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    """Drop all tables."""
    op.drop_table("embeddings")
    op.drop_table("processing_jobs")
    op.drop_table("lease_chain_documents")
    op.drop_table("lease_chains")
    op.drop_table("duplicate_group_members")
    op.drop_table("duplicate_groups")
    op.drop_table("documents")
    op.drop_table("deals")
    op.drop_table("users")

    for enum_name in [
        "deal_status", "document_category", "match_type",
        "lease_doc_type", "processing_status", "processing_stage",
    ]:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")

    op.execute("DROP EXTENSION IF EXISTS vector")

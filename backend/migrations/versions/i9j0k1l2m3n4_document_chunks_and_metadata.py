"""Add document_chunks table and document metadata columns for embeddings + chat + deal analysis.

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-03-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "i9j0k1l2m3n4"
down_revision = "h8i9j0k1l2m3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── New metadata columns on documents ────────────────────────────────
    op.add_column("documents", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("expiry_date", sa.Text(), nullable=True))
    op.add_column("documents", sa.Column("has_signature", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("documents", sa.Column("has_seal", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("documents", sa.Column("key_terms", JSONB(), nullable=True))
    op.add_column("documents", sa.Column("parties", JSONB(), nullable=True))

    # ── Enable pgvector extension (idempotent) ───────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── document_chunks table ────────────────────────────────────────────
    op.create_table(
        "document_chunks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("deal_id", UUID(as_uuid=True), sa.ForeignKey("deals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metadata", JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # Add the embedding column via raw SQL (vector type not in SA dialect)
    op.execute("ALTER TABLE document_chunks ADD COLUMN embedding vector(768)")

    # ── Indexes ──────────────────────────────────────────────────────────
    op.create_index("idx_chunks_document", "document_chunks", ["document_id"])
    op.create_index("idx_chunks_deal", "document_chunks", ["deal_id"])
    op.create_index("idx_chunks_doc_order", "document_chunks", ["document_id", "chunk_index"])

    # HNSW index for fast vector similarity search (cosine distance)
    op.execute("""
        CREATE INDEX idx_chunks_embedding
        ON document_chunks
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)


def downgrade() -> None:
    op.drop_table("document_chunks")
    op.drop_column("documents", "parties")
    op.drop_column("documents", "key_terms")
    op.drop_column("documents", "has_seal")
    op.drop_column("documents", "has_signature")
    op.drop_column("documents", "expiry_date")
    op.drop_column("documents", "summary")

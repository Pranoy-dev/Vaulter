"""add gemini processing columns and extraction_segments table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-03-27 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str]] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Change assigned_category from ENUM to TEXT ───────────────────────
    # 1. Add a temporary TEXT column
    op.add_column("documents", sa.Column("assigned_category_text", sa.Text, nullable=True))
    # 2. Copy values
    op.execute("UPDATE documents SET assigned_category_text = assigned_category::text")
    # 3. Drop the old ENUM column
    op.drop_column("documents", "assigned_category")
    # 4. Rename the new column
    op.alter_column("documents", "assigned_category_text", new_column_name="assigned_category")
    # 5. Set default
    op.alter_column(
        "documents", "assigned_category",
        server_default="other",
        nullable=True,
    )
    # 6. Drop the old enum type (safe — no longer referenced)
    op.execute("DROP TYPE IF EXISTS document_category")

    # ── Add new columns to documents ────────────────────────────────────
    op.add_column("documents", sa.Column("extracted_text", sa.Text, nullable=True))
    op.add_column("documents", sa.Column("is_incomplete", sa.Boolean, server_default="false", nullable=False))
    op.add_column("documents", sa.Column(
        "incompleteness_reasons", JSONB, nullable=True,
    ))
    op.add_column("documents", sa.Column("classification_reasoning", sa.Text, nullable=True))

    # ── Add processing_stage enum value ─────────────────────────────────
    op.execute("ALTER TYPE processing_stage ADD VALUE IF NOT EXISTS 'document_processing' BEFORE 'detecting_duplicates'")

    # ── Create extraction_segments table ────────────────────────────────
    op.create_table(
        "extraction_segments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("segment_index", sa.Integer, nullable=False),
        sa.Column("page_start", sa.Integer, nullable=False),
        sa.Column("page_end", sa.Integer, nullable=False),
        sa.Column("gemini_file_uri", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=False, server_default="pending"),
        sa.Column("extracted_text", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_extraction_segments_doc", "extraction_segments", ["document_id"])


def downgrade() -> None:
    op.drop_index("idx_extraction_segments_doc", table_name="extraction_segments")
    op.drop_table("extraction_segments")

    op.drop_column("documents", "classification_reasoning")
    op.drop_column("documents", "incompleteness_reasons")
    op.drop_column("documents", "is_incomplete")
    op.drop_column("documents", "extracted_text")

    # Recreate the ENUM type and column
    op.execute("CREATE TYPE document_category AS ENUM ('leases_amendments', 'financial', 'technical_environmental', 'corporate_legal', 'other')")
    op.add_column("documents", sa.Column("assigned_category_enum", sa.Enum(
        "leases_amendments", "financial", "technical_environmental", "corporate_legal", "other",
        name="document_category", create_type=False,
    ), server_default="other"))
    op.execute("UPDATE documents SET assigned_category_enum = assigned_category::document_category")
    op.drop_column("documents", "assigned_category")
    op.alter_column("documents", "assigned_category_enum", new_column_name="assigned_category")

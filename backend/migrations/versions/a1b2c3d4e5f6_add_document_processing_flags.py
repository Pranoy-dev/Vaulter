"""add_document_processing_flags

Revision ID: a1b2c3d4e5f6
Revises: 38d11cca0a66
Create Date: 2026-03-26 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '38d11cca0a66'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("rag_indexed", sa.Boolean, nullable=False, server_default="false"),
    )
    op.add_column(
        "documents",
        sa.Column("rag_indexed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "documents",
        sa.Column("classified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_documents_rag_indexed", "documents", ["deal_id", "rag_indexed"])


def downgrade() -> None:
    op.drop_index("idx_documents_rag_indexed", table_name="documents")
    op.drop_column("documents", "classified_at")
    op.drop_column("documents", "rag_indexed_at")
    op.drop_column("documents", "rag_indexed")

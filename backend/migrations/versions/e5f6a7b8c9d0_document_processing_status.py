"""add processing_status to documents

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-27 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str]] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("processing_status", sa.Text, nullable=False, server_default="pending"),
    )
    op.create_index("idx_documents_processing_status", "documents", ["deal_id", "processing_status"])


def downgrade() -> None:
    op.drop_index("idx_documents_processing_status", table_name="documents")
    op.drop_column("documents", "processing_status")

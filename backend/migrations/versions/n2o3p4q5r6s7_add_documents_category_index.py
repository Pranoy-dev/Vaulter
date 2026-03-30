"""add_documents_category_index

Revision ID: n2o3p4q5r6s7
Revises: m1n2o3p4q5r6
Create Date: 2026-03-30 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'n2o3p4q5r6s7'
down_revision: Union[str, Sequence[str], None] = 'm1n2o3p4q5r6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "idx_documents_category",
        "documents",
        ["deal_id", "assigned_category"],
    )


def downgrade() -> None:
    op.drop_index("idx_documents_category", table_name="documents")

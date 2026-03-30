"""add_insights_cache_to_deals

Revision ID: o1p2q3r4s5t6
Revises: n2o3p4q5r6s7
Create Date: 2026-03-30 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'o1p2q3r4s5t6'
down_revision: Union[str, Sequence[str], None] = 'n2o3p4q5r6s7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "deals",
        sa.Column("insights_cache", JSONB, nullable=True),
    )
    op.add_column(
        "deals",
        sa.Column("insights_cached_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("deals", "insights_cached_at")
    op.drop_column("deals", "insights_cache")

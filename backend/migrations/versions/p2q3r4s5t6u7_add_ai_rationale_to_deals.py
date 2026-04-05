"""add_ai_rationale_to_deals

Revision ID: p2q3r4s5t6u7
Revises: o1p2q3r4s5t6
Create Date: 2026-04-05 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'p2q3r4s5t6u7'
down_revision: Union[str, Sequence[str], None] = 'o1p2q3r4s5t6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "deals",
        sa.Column("ai_rationale", JSONB, nullable=True),
    )
    op.add_column(
        "deals",
        sa.Column("ai_rationale_generated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("deals", "ai_rationale_generated_at")
    op.drop_column("deals", "ai_rationale")

"""add_description_to_deals

Revision ID: m1n2o3p4q5r6
Revises: l2m3n4o5p6q7
Create Date: 2026-03-30 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'm1n2o3p4q5r6'
down_revision: Union[str, Sequence[str], None] = 'l2m3n4o5p6q7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "deals",
        sa.Column("description", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("deals", "description")

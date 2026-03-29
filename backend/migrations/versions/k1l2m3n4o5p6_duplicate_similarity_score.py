"""Add similarity_score to duplicate_group_members for content-based matching.

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-03-29

"""
from alembic import op
import sqlalchemy as sa

revision = "k1l2m3n4o5p6"
down_revision = "j0k1l2m3n4o5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "duplicate_group_members",
        sa.Column("similarity_score", sa.Float(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("duplicate_group_members", "similarity_score")

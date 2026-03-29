"""Add detecting_hash_duplicates value to processing_stage enum.

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-03-29

"""
from alembic import op

revision = "l2m3n4o5p6q7"
down_revision = "k1l2m3n4o5p6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE processing_stage ADD VALUE IF NOT EXISTS 'detecting_hash_duplicates' BEFORE 'document_processing'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values — downgrade is a no-op
    pass

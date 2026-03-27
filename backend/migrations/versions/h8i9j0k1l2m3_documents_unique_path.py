"""unique constraint on documents(deal_id, original_path)

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-03-27

"""
from alembic import op

revision = "h8i9j0k1l2m3"
down_revision = "g7h8i9j0k1l2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove duplicate rows keeping the most recently created one before adding the constraint
    op.execute("""
        DELETE FROM documents
        WHERE id NOT IN (
            SELECT DISTINCT ON (deal_id, original_path) id
            FROM documents
            ORDER BY deal_id, original_path, created_at DESC
        )
    """)
    op.create_unique_constraint(
        "uq_documents_deal_original_path",
        "documents",
        ["deal_id", "original_path"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_documents_deal_original_path", "documents", type_="unique")

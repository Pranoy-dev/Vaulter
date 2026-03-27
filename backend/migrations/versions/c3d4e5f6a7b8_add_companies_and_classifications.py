"""add companies and classifications

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-27 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str]] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── companies ────────────────────────────────────────────────────────
    op.create_table(
        "companies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # ── company_classifications ──────────────────────────────────────────
    op.create_table(
        "company_classifications",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("company_id", UUID(as_uuid=True), sa.ForeignKey("companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.Text, nullable=False),
        sa.Column("label", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("display_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_classifications_company", "company_classifications", ["company_id"])
    op.create_unique_constraint("uq_company_classification_key", "company_classifications", ["company_id", "key"])

    # ── Add company_id to users ──────────────────────────────────────────
    op.add_column("users", sa.Column("company_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_users_company_id",
        "users", "companies",
        ["company_id"], ["id"],
        ondelete="SET NULL",
    )

    # ── Add company_id to deals ──────────────────────────────────────────
    op.add_column("deals", sa.Column("company_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_deals_company_id",
        "deals", "companies",
        ["company_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_deals_company", "deals", ["company_id"])

    # ── Enable RLS on new tables ─────────────────────────────────────────
    for table in ["companies", "company_classifications"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("idx_deals_company", table_name="deals")
    op.drop_constraint("fk_deals_company_id", "deals", type_="foreignkey")
    op.drop_column("deals", "company_id")

    op.drop_constraint("fk_users_company_id", "users", type_="foreignkey")
    op.drop_column("users", "company_id")

    op.drop_table("company_classifications")
    op.drop_table("companies")

"""add blueprint asset storage metadata

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-28
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "blueprint_assets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("floor_id", sa.Integer(), nullable=False),
        sa.Column("storage_backend", sa.String(length=20), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("scale_mm_per_pixel", sa.Float(), nullable=True),
        sa.Column("origin_x", sa.Float(), nullable=False),
        sa.Column("origin_y", sa.Float(), nullable=False),
        sa.Column("rotation_deg", sa.Float(), nullable=False),
        sa.Column("crop", sa.JSON(), nullable=True),
        sa.Column("pdf_page", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["floor_id"], ["floors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_blueprint_assets_floor_id"), "blueprint_assets", ["floor_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_blueprint_assets_floor_id"), table_name="blueprint_assets")
    op.drop_table("blueprint_assets")

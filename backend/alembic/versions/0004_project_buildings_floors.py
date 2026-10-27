"""add project buildings and floors

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "buildings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_buildings_id"), "buildings", ["id"], unique=False)
    op.create_index(op.f("ix_buildings_project_id"), "buildings", ["project_id"], unique=False)
    op.create_table(
        "floors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("building_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["building_id"], ["buildings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_floors_id"), "floors", ["id"], unique=False)
    op.create_index(op.f("ix_floors_building_id"), "floors", ["building_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_floors_building_id"), table_name="floors")
    op.drop_index(op.f("ix_floors_id"), table_name="floors")
    op.drop_table("floors")
    op.drop_index(op.f("ix_buildings_project_id"), table_name="buildings")
    op.drop_index(op.f("ix_buildings_id"), table_name="buildings")
    op.drop_table("buildings")

"""Add project-scoped boards, circuits and loads.

Revision ID: 0008
Revises: 0007
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "distribution_boards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "floor_id",
            sa.Integer(),
            sa.ForeignKey("floors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
    )
    op.create_index(
        "ix_distribution_boards_project_id", "distribution_boards", ["project_id"]
    )
    op.create_index(
        "ix_distribution_boards_floor_id", "distribution_boards", ["floor_id"]
    )
    op.create_table(
        "distribution_circuits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "board_id",
            sa.Integer(),
            sa.ForeignKey("distribution_boards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
    )
    op.create_index(
        "ix_distribution_circuits_board_id", "distribution_circuits", ["board_id"]
    )
    op.create_table(
        "distribution_loads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "circuit_id",
            sa.Integer(),
            sa.ForeignKey("distribution_circuits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "floor_id",
            sa.Integer(),
            sa.ForeignKey("floors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("name", sa.String(200), nullable=False),
    )
    op.create_index(
        "ix_distribution_loads_circuit_id", "distribution_loads", ["circuit_id"]
    )
    op.create_index(
        "ix_distribution_loads_floor_id", "distribution_loads", ["floor_id"]
    )


def downgrade() -> None:
    op.drop_table("distribution_loads")
    op.drop_table("distribution_circuits")
    op.drop_table("distribution_boards")

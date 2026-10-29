"""Store transfer-safe topology attributes and load links.

Revision ID: 0010
Revises: 0009
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "distribution_boards",
        sa.Column("data", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.add_column(
        "distribution_circuits",
        sa.Column("data", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.add_column(
        "distribution_circuits", sa.Column("source_id", sa.String(80), nullable=True)
    )
    op.add_column(
        "distribution_loads",
        sa.Column("placement_id", sa.String(80), nullable=True),
    )
    op.add_column(
        "distribution_loads",
        sa.Column("data", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("distribution_loads", "data")
    op.drop_column("distribution_loads", "placement_id")
    op.drop_column("distribution_circuits", "source_id")
    op.drop_column("distribution_circuits", "data")
    op.drop_column("distribution_boards", "data")

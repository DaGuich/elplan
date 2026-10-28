"""store floor-plan and circuit documentation data

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "floors",
        sa.Column("plan_data", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )
    op.alter_column("floors", "plan_data", server_default=None)


def downgrade() -> None:
    op.drop_column("floors", "plan_data")

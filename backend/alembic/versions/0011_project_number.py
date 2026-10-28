"""Add project number to project details.

Floor annotation values (customer_name, project_number) stay untouched as legacy fallbacks.

Revision ID: 0011
Revises: 0010
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("project_details", sa.Column("project_number", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("project_details", "project_number")

"""add project archive and client share links

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-27
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("projects", "archived", server_default=None)
    op.create_table(
        "project_shares",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("client_view", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("password_hash", sa.String(length=200), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_project_shares_project_id"), "project_shares", ["project_id"], unique=False)
    op.create_index(op.f("ix_project_shares_token"), "project_shares", ["token"], unique=True)
    op.alter_column("project_shares", "client_view", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_project_shares_token"), table_name="project_shares")
    op.drop_index(op.f("ix_project_shares_project_id"), table_name="project_shares")
    op.drop_table("project_shares")
    op.drop_column("projects", "archived")

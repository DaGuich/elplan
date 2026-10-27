"""create projects table

Revision ID: 0001
Revises:
Create Date: 2026-10-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("projects"):
        return

    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.String(length=2000), nullable=True),
    )
    op.create_index(op.f("ix_projects_id"), "projects", ["id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_projects_id"), table_name="projects")
    op.drop_table("projects")

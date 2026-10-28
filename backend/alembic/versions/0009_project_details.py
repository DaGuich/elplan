"""Add project details (client, site, status, electrical, pricing).

Revision ID: 0009
Revises: 0008
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_details",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="planning"),
        sa.Column("client_name", sa.String(200), nullable=True),
        sa.Column("client_email", sa.String(200), nullable=True),
        sa.Column("client_phone", sa.String(50), nullable=True),
        sa.Column("client_address", sa.String(500), nullable=True),
        sa.Column("site_street", sa.String(200), nullable=True),
        sa.Column("site_postal_code", sa.String(20), nullable=True),
        sa.Column("site_city", sa.String(100), nullable=True),
        sa.Column("site_country", sa.String(100), nullable=True),
        sa.Column("nominal_voltage_v", sa.Integer(), nullable=True),
        sa.Column("phases", sa.Integer(), nullable=True),
        sa.Column("frequency_hz", sa.Integer(), nullable=True),
        sa.Column("grid_system", sa.String(10), nullable=True),
        sa.Column("main_fuse_a", sa.Float(), nullable=True),
        sa.Column("short_circuit_ka", sa.Float(), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("vat_percent", sa.Float(), nullable=True),
        sa.Column("hourly_rate", sa.Float(), nullable=True),
        sa.Column("material_markup_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("pricing_templates", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.create_index("ix_project_details_project_id", "project_details", ["project_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_project_details_project_id", table_name="project_details")
    op.drop_table("project_details")

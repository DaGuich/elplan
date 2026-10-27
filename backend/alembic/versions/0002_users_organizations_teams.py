"""users organizations teams

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-27 13:22:40.679110
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('organizations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('password_hash', sa.String(length=300), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_table('memberships',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('organization_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('organization_id', 'user_id')
    )
    op.create_index(op.f('ix_memberships_organization_id'), 'memberships', ['organization_id'], unique=False)
    op.create_index(op.f('ix_memberships_user_id'), 'memberships', ['user_id'], unique=False)
    op.create_table('teams',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('organization_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('organization_id', 'name')
    )
    op.create_index(op.f('ix_teams_organization_id'), 'teams', ['organization_id'], unique=False)
    op.create_table('team_members',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('team_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('team_id', 'user_id')
    )
    op.create_index(op.f('ix_team_members_team_id'), 'team_members', ['team_id'], unique=False)
    op.create_index(op.f('ix_team_members_user_id'), 'team_members', ['user_id'], unique=False)
    # Existing projects have no owning organization; they cannot be migrated.
    op.execute('DELETE FROM projects')
    op.add_column('projects', sa.Column('organization_id', sa.Integer(), nullable=False))
    op.add_column('projects', sa.Column('team_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_projects_organization_id'), 'projects', ['organization_id'], unique=False)
    op.create_index(op.f('ix_projects_team_id'), 'projects', ['team_id'], unique=False)
    op.create_foreign_key('fk_projects_organization_id', 'projects', 'organizations', ['organization_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('fk_projects_team_id', 'projects', 'teams', ['team_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('fk_projects_team_id', 'projects', type_='foreignkey')
    op.drop_constraint('fk_projects_organization_id', 'projects', type_='foreignkey')
    op.drop_index(op.f('ix_projects_team_id'), table_name='projects')
    op.drop_index(op.f('ix_projects_organization_id'), table_name='projects')
    op.drop_column('projects', 'team_id')
    op.drop_column('projects', 'organization_id')
    op.drop_index(op.f('ix_team_members_user_id'), table_name='team_members')
    op.drop_index(op.f('ix_team_members_team_id'), table_name='team_members')
    op.drop_table('team_members')
    op.drop_index(op.f('ix_teams_organization_id'), table_name='teams')
    op.drop_table('teams')
    op.drop_index(op.f('ix_memberships_user_id'), table_name='memberships')
    op.drop_index(op.f('ix_memberships_organization_id'), table_name='memberships')
    op.drop_table('memberships')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_table('organizations')

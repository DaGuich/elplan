"""Central authorization rules. Project items must reuse `require_project_access`."""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import ROLE_ADMIN, ROLE_OWNER, Membership, Team, TeamMember
from app.models.project import Project
from app.models.user import User


def get_membership(db: Session, org_id: int, user_id: int) -> Membership | None:
    return db.scalar(
        select(Membership).where(Membership.organization_id == org_id, Membership.user_id == user_id)
    )


def require_member(db: Session, org_id: int, user: User) -> Membership:
    m = get_membership(db, org_id, user.id)
    if m is None:
        # Do not reveal whether the organization exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return m


def require_org_admin(db: Session, org_id: int, user: User) -> Membership:
    m = require_member(db, org_id, user)
    if m.role not in (ROLE_OWNER, ROLE_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return m


def is_team_member(db: Session, team_id: int, user_id: int) -> bool:
    return (
        db.scalar(
            select(TeamMember.id).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
        )
        is not None
    )


def get_team(db: Session, org_id: int, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None or team.organization_id != org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")
    return team


def can_access_project(db: Session, project: Project, user: User) -> bool:
    if get_membership(db, project.organization_id, user.id) is None:
        return False
    if project.team_id is None:
        return True
    return is_team_member(db, project.team_id, user.id)


def require_project_access(db: Session, project_id: int, user: User) -> Project:
    project = db.get(Project, project_id)
    if project is None or not can_access_project(db, project, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project

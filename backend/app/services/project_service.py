from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.organization import Membership, TeamMember
from app.models.project import Project
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services.access import get_team, is_team_member, require_member


def list_projects(db: Session, user: User, organization_id: int | None = None) -> list[Project]:
    team_ids = select(TeamMember.team_id).where(TeamMember.user_id == user.id)
    org_ids = select(Membership.organization_id).where(Membership.user_id == user.id)
    stmt = (
        select(Project)
        .where(Project.organization_id.in_(org_ids))
        .where(or_(Project.team_id.is_(None), Project.team_id.in_(team_ids)))
        .order_by(Project.id.desc())
    )
    if organization_id is not None:
        stmt = stmt.where(Project.organization_id == organization_id)
    return list(db.scalars(stmt))


def _check_team(db: Session, org_id: int, team_id: int | None, user: User) -> None:
    if team_id is None:
        return
    get_team(db, org_id, team_id)
    if not is_team_member(db, team_id, user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this team")


def create_project(db: Session, user: User, data: ProjectCreate) -> Project:
    require_member(db, data.organization_id, user)
    _check_team(db, data.organization_id, data.team_id, user)
    row = Project(
        organization_id=data.organization_id,
        team_id=data.team_id,
        name=data.name,
        description=data.description,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_project(db: Session, user: User, project: Project, data: ProjectUpdate) -> Project:
    fields = data.model_dump(exclude_unset=True)
    if "team_id" in fields and fields["team_id"] != project.team_id:
        _check_team(db, project.organization_id, fields["team_id"], user)
    if fields.get("name") is None:
        fields.pop("name", None)
    for key, value in fields.items():
        setattr(project, key, value)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project: Project) -> None:
    db.delete(project)
    db.commit()

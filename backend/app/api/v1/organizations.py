from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.organization import (
    ROLE_OWNER,
    Membership,
    Organization,
    Team,
    TeamMember,
)
from app.models.user import User
from app.schemas.organization import (
    MemberAdd,
    MemberRead,
    MemberUpdate,
    OrganizationCreate,
    OrganizationRead,
    TeamCreate,
    TeamMemberAdd,
    TeamRead,
)
from app.services.access import get_membership, get_team, require_member, require_org_admin

router = APIRouter(prefix="/organizations", tags=["organizations"])


def _member_read(m: Membership, u: User) -> MemberRead:
    return MemberRead(user_id=u.id, email=u.email, name=u.name, role=m.role)


def _owner_count(db: Session, org_id: int) -> int:
    return db.scalar(
        select(func.count()).select_from(Membership).where(
            Membership.organization_id == org_id, Membership.role == ROLE_OWNER
        )
    )


def _lock_organization(db: Session, org_id: int) -> None:
    db.scalar(select(Organization.id).where(Organization.id == org_id).with_for_update())


@router.get("", response_model=list[OrganizationRead])
def list_organizations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.execute(
        select(Organization, Membership.role)
        .join(Membership, Membership.organization_id == Organization.id)
        .where(Membership.user_id == user.id)
        .order_by(Organization.name)
    )
    return [OrganizationRead(id=o.id, name=o.name, role=role) for o, role in rows]


@router.post("", response_model=OrganizationRead, status_code=status.HTTP_201_CREATED)
def create_organization(
    payload: OrganizationCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    org = Organization(name=payload.name)
    db.add(org)
    db.flush()
    db.add(Membership(organization_id=org.id, user_id=user.id, role=ROLE_OWNER))
    db.commit()
    return OrganizationRead(id=org.id, name=org.name, role=ROLE_OWNER)


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organization(
    org_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    m = require_member(db, org_id, user)
    if m.role != ROLE_OWNER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner role required")
    db.delete(db.get(Organization, org_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{org_id}/members", response_model=list[MemberRead])
def list_members(org_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_member(db, org_id, user)
    rows = db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.organization_id == org_id)
        .order_by(User.name)
    )
    return [_member_read(m, u) for m, u in rows]


@router.post("/{org_id}/members", response_model=MemberRead, status_code=status.HTTP_201_CREATED)
def add_member(
    org_id: int,
    payload: MemberAdd,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    actor = require_org_admin(db, org_id, user)
    if payload.role == ROLE_OWNER and actor.role != ROLE_OWNER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners can add owners")
    target = db.scalar(select(User).where(func.lower(User.email) == payload.email.lower()))
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if get_membership(db, org_id, target.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Already a member")
    m = Membership(organization_id=org_id, user_id=target.id, role=payload.role)
    db.add(m)
    db.commit()
    return _member_read(m, target)


@router.patch("/{org_id}/members/{user_id}", response_model=MemberRead)
def update_member(
    org_id: int,
    user_id: int,
    payload: MemberUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _lock_organization(db, org_id)
    actor = require_org_admin(db, org_id, user)
    m = get_membership(db, org_id, user_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if actor.role != ROLE_OWNER and (m.role == ROLE_OWNER or payload.role == ROLE_OWNER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners can change owner roles")
    if m.role == ROLE_OWNER and payload.role != ROLE_OWNER and _owner_count(db, org_id) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organization needs at least one owner")
    m.role = payload.role
    db.commit()
    return _member_read(m, db.get(User, user_id))


@router.delete("/{org_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    org_id: int, user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    _lock_organization(db, org_id)
    # Members may leave on their own; otherwise admin rights are needed.
    actor = require_member(db, org_id, user) if user_id == user.id else require_org_admin(db, org_id, user)
    m = get_membership(db, org_id, user_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if m.role == ROLE_OWNER:
        if actor.role != ROLE_OWNER:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owners can remove owners")
        if _owner_count(db, org_id) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organization needs at least one owner")
    team_ids = select(Team.id).where(Team.organization_id == org_id)
    for tm in db.scalars(
        select(TeamMember).where(TeamMember.user_id == user_id, TeamMember.team_id.in_(team_ids))
    ):
        db.delete(tm)
    db.delete(m)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{org_id}/teams", response_model=list[TeamRead])
def list_teams(org_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_member(db, org_id, user)
    return list(db.scalars(select(Team).where(Team.organization_id == org_id).order_by(Team.name)))


@router.post("/{org_id}/teams", response_model=TeamRead, status_code=status.HTTP_201_CREATED)
def create_team(
    org_id: int,
    payload: TeamCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_org_admin(db, org_id, user)
    if db.scalar(select(Team.id).where(Team.organization_id == org_id, Team.name == payload.name)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Team name already exists")
    team = Team(organization_id=org_id, name=payload.name)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=user.id))
    db.commit()
    db.refresh(team)
    return team


@router.delete("/{org_id}/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    org_id: int, team_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    require_org_admin(db, org_id, user)
    db.delete(get_team(db, org_id, team_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{org_id}/teams/{team_id}/members", response_model=list[MemberRead])
def list_team_members(
    org_id: int, team_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    require_member(db, org_id, user)
    get_team(db, org_id, team_id)
    rows = db.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .join(TeamMember, TeamMember.user_id == User.id)
        .where(TeamMember.team_id == team_id, Membership.organization_id == org_id)
        .order_by(User.name)
    )
    return [_member_read(m, u) for m, u in rows]


@router.post(
    "/{org_id}/teams/{team_id}/members", status_code=status.HTTP_201_CREATED, response_model=MemberRead
)
def add_team_member(
    org_id: int,
    team_id: int,
    payload: TeamMemberAdd,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_org_admin(db, org_id, user)
    get_team(db, org_id, team_id)
    m = get_membership(db, org_id, payload.user_id)
    if m is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User is not an organization member")
    exists = db.scalar(
        select(TeamMember.id).where(TeamMember.team_id == team_id, TeamMember.user_id == payload.user_id)
    )
    if not exists:
        db.add(TeamMember(team_id=team_id, user_id=payload.user_id))
        db.commit()
    return _member_read(m, db.get(User, payload.user_id))


@router.delete("/{org_id}/teams/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_team_member(
    org_id: int,
    team_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_org_admin(db, org_id, user)
    get_team(db, org_id, team_id)
    tm = db.scalar(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
    )
    if tm:
        db.delete(tm)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

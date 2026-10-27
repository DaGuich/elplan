from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from app.services.access import require_project_access
from app.services.project_service import (
    create_project,
    delete_project,
    list_projects,
    update_project,
)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
def get_projects(
    organization_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return list_projects(db, user, organization_id)


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def post_project(
    payload: ProjectCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return create_project(db, user, payload)


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(
    project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    return require_project_access(db, project_id, user)


@router.patch("/{project_id}", response_model=ProjectRead)
def patch_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    return update_project(db, user, project, payload)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project(
    project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    delete_project(db, require_project_access(db, project_id, user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

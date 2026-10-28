from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.project_details import ProjectDetailsData, ProjectDetailsRead
from app.services import project_details
from app.services.access import require_project_access

router = APIRouter(prefix="/projects/{project_id}/details", tags=["project details"])


@router.get("", response_model=ProjectDetailsRead)
def get_project_details(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return project_details.get_details(db, require_project_access(db, project_id, user))


@router.put("", response_model=ProjectDetailsRead)
def put_project_details(
    project_id: int,
    payload: ProjectDetailsData,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return project_details.update_details(db, require_project_access(db, project_id, user), payload)

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.schemas.project import ProjectCreate, ProjectRead
from app.services.project_service import list_projects, create_project

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
def get_projects(db: Session = Depends(get_db)):
    return list_projects(db)


@router.post("", response_model=ProjectRead)
def post_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    return create_project(db, payload)

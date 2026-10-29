from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.project_details import ProjectDetails
from app.schemas.project_details import ProjectDetailsData, ProjectDetailsRead


def get_details(db: Session, project: Project) -> ProjectDetailsRead:
    row = db.scalar(select(ProjectDetails).where(ProjectDetails.project_id == project.id))
    if row is None:
        return ProjectDetailsRead()
    return ProjectDetailsRead.model_validate(row)


def apply_details(db: Session, project: Project, data: ProjectDetailsData) -> None:
    """Upsert without committing, so callers can keep it in their own transaction."""
    row = db.scalar(select(ProjectDetails).where(ProjectDetails.project_id == project.id))
    if row is None:
        row = ProjectDetails(project_id=project.id)
        db.add(row)
    for key, value in data.model_dump().items():
        setattr(row, key, value)


def update_details(db: Session, project: Project, data: ProjectDetailsData) -> ProjectDetailsRead:
    apply_details(db, project, data)
    db.commit()
    return get_details(db, project)


def export_details(db: Session, project: Project) -> dict:
    return get_details(db, project).model_dump()

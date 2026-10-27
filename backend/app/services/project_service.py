from sqlalchemy.orm import Session

from app.models.project import Project
from app.schemas.project import ProjectCreate


def list_projects(db: Session) -> list[Project]:
    return db.query(Project).order_by(Project.id.desc()).all()


def create_project(db: Session, data: ProjectCreate) -> Project:
    row = Project(name=data.name, description=data.description)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

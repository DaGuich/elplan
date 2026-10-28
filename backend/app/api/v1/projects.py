import json

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.project import (
    BuildingCreate,
    BuildingRead,
    BuildingUpdate,
    FloorCreate,
    FloorPlanData,
    FloorRead,
    FloorUpdate,
    ProjectCreate,
    ProjectImport,
    ProjectRead,
    ProjectShareCreate,
    ProjectShareRead,
    ProjectTransfer,
    ProjectUpdate,
    PublicProjectRead,
)
from app.services.access import require_project_access
from app.services.blueprint_service import export_blueprint
from app.services.project_details import export_details
from app.services.project_service import (
    create_building,
    create_floor,
    create_project,
    create_project_share,
    delete_building,
    delete_floor,
    delete_project,
    delete_project_share,
    duplicate_floor,
    duplicate_project,
    import_project,
    list_buildings,
    list_project_shares,
    list_projects,
    read_floor_plan_data,
    read_shared_project,
    transfer_project,
    update_building,
    update_floor,
    update_project,
    write_floor_plan_data,
)
from app.services.topology import ensure_legacy_topology, export_topology

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
def get_projects(
    organization_id: int | None = None,
    include_archived: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return list_projects(db, user, organization_id, include_archived)


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def post_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return create_project(db, user, payload)


@router.post("/import", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def post_project_import(
    payload: ProjectImport,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return import_project(db, user, payload)


@router.get("/shared/{token}", response_model=PublicProjectRead)
def get_shared_project(
    token: str,
    password: str | None = Header(default=None, alias="X-Share-Password"),
    db: Session = Depends(get_db),
):
    return read_shared_project(db, token, password)


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return require_project_access(db, project_id, user)


@router.post(
    "/{project_id}/duplicate",
    response_model=ProjectRead,
    status_code=status.HTTP_201_CREATED,
)
def post_project_duplicate(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    return duplicate_project(db, user, project)


@router.post("/{project_id}/transfer", response_model=ProjectRead)
def post_project_transfer(
    project_id: int,
    payload: ProjectTransfer,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    return transfer_project(db, user, project, payload)


@router.post(
    "/{project_id}/shares",
    response_model=ProjectShareRead,
    status_code=status.HTTP_201_CREATED,
)
def post_project_share(
    project_id: int,
    payload: ProjectShareCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    share = create_project_share(db, project, payload)
    return ProjectShareRead(id=share.id, token=share.token, client_view=share.client_view)


@router.get("/{project_id}/shares", response_model=list[ProjectShareRead])
def get_project_shares(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    return [
        ProjectShareRead(id=share.id, token=share.token, client_view=share.client_view)
        for share in list_project_shares(db, project)
    ]


@router.delete("/{project_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_share(
    project_id: int,
    share_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    delete_project_share(db, project, share_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/export")
def export_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    if ensure_legacy_topology(db, project):
        db.commit()
    buildings = list_buildings(db, project)
    return {
        "name": project.name,
        "description": project.description,
        "details": export_details(db, project),
        "topology": export_topology(db, project),
        "buildings": [
            {
                "name": building.name,
                "floors": [
                    {
                        "name": floor.name,
                        "plan_data": FloorPlanData.model_validate(
                            read_floor_plan_data(db, project, floor.id)
                        ).model_dump(),
                        "blueprint": export_blueprint(db, floor),
                    }
                    for floor in building.floors
                ],
            }
            for building in buildings
        ],
    }


@router.get("/{project_id}/buildings", response_model=list[BuildingRead])
def get_buildings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    return list_buildings(db, project)


@router.post(
    "/{project_id}/buildings",
    response_model=BuildingRead,
    status_code=status.HTTP_201_CREATED,
)
def post_building(
    project_id: int,
    payload: BuildingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    return create_building(db, project, payload)


@router.patch("/{project_id}/buildings/{building_id}", response_model=BuildingRead)
def patch_building(
    project_id: int,
    building_id: int,
    payload: BuildingUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    update_building(db, project, building_id, payload)
    return next(building for building in list_buildings(db, project) if building.id == building_id)


@router.delete("/{project_id}/buildings/{building_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_building(
    project_id: int,
    building_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    delete_building(db, require_project_access(db, project_id, user), building_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{project_id}/buildings/{building_id}/floors",
    response_model=FloorRead,
    status_code=status.HTTP_201_CREATED,
)
def post_floor(
    project_id: int,
    building_id: int,
    payload: FloorCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    return create_floor(db, project, building_id, payload)


@router.patch("/{project_id}/floors/{floor_id}", response_model=FloorRead)
def patch_floor(
    project_id: int,
    floor_id: int,
    payload: FloorUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return update_floor(db, require_project_access(db, project_id, user), floor_id, payload)


@router.post(
    "/{project_id}/floors/{floor_id}/duplicate",
    response_model=FloorRead,
    status_code=status.HTTP_201_CREATED,
)
def post_floor_duplicate(
    project_id: int,
    floor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return duplicate_floor(db, require_project_access(db, project_id, user), floor_id)


@router.delete("/{project_id}/floors/{floor_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_floor(
    project_id: int,
    floor_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    delete_floor(db, require_project_access(db, project_id, user), floor_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/floors/{floor_id}/plan", response_model=FloorPlanData)
def read_floor_plan(
    project_id: int,
    floor_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    data = read_floor_plan_data(db, project, floor_id)
    _attach_topology_warnings(response, data)
    return data


@router.put("/{project_id}/floors/{floor_id}/plan", response_model=FloorPlanData)
def put_floor_plan(
    project_id: int,
    floor_id: int,
    payload: FloorPlanData,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    data = write_floor_plan_data(db, project, floor_id, payload)
    _attach_topology_warnings(response, data)
    return data


def _attach_topology_warnings(response: Response, data: dict) -> None:
    if "topology_revision" in data:
        response.headers["X-Topology-Revision"] = str(data["topology_revision"])
    warnings = data.pop("topology_warnings", [])
    if warnings:
        response.headers["X-Topology-Warnings"] = json.dumps(warnings[:20], ensure_ascii=True)


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
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    delete_project(db, require_project_access(db, project_id, user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

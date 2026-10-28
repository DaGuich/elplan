import secrets

from app.core.security import hash_password, verify_password
from app.models.organization import Membership, TeamMember
from app.models.project import Building, Floor, Project, ProjectShare
from app.models.user import User
from app.schemas.project import (
    BuildingCreate,
    BuildingUpdate,
    FloorCreate,
    FloorPlanData,
    FloorUpdate,
    ProjectCreate,
    ProjectImport,
    ProjectShareCreate,
    ProjectTransfer,
    ProjectUpdate,
)
from app.services.access import (
    get_team,
    is_team_member,
    require_member,
    require_org_admin,
)
from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload


def list_projects(
    db: Session,
    user: User,
    organization_id: int | None = None,
    include_archived: bool = False,
) -> list[Project]:
    team_ids = select(TeamMember.team_id).where(TeamMember.user_id == user.id)
    org_ids = select(Membership.organization_id).where(Membership.user_id == user.id)
    stmt = (
        select(Project)
        .where(Project.organization_id.in_(org_ids))
        .where(or_(Project.team_id.is_(None), Project.team_id.in_(team_ids)))
        .order_by(Project.id.desc())
    )
    if not include_archived:
        stmt = stmt.where(Project.archived.is_(False))
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


def import_project(db: Session, user: User, data: ProjectImport) -> Project:
    require_member(db, data.organization_id, user)
    _check_team(db, data.organization_id, data.team_id, user)
    project = Project(
        organization_id=data.organization_id,
        team_id=data.team_id,
        name=data.name,
        description=data.description,
    )
    project.buildings = [
        Building(
            name=building.name,
            floors=[
                Floor(
                    name=floor.name,
                    sort_order=index,
                    plan_data=floor.plan_data.model_dump(),
                )
                for index, floor in enumerate(building.floors)
            ],
        )
        for building in data.buildings
    ]
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def duplicate_project(db: Session, user: User, project: Project) -> Project:
    buildings = list_buildings(db, project)
    return import_project(
        db,
        user,
        ProjectImport(
            organization_id=project.organization_id,
            team_id=project.team_id,
            name=f"{project.name} (copy)",
            description=project.description,
            buildings=[
                {
                    "name": building.name,
                    "floors": [
                        {
                            "name": floor.name,
                            "plan_data": FloorPlanData.model_validate(floor.plan_data),
                        }
                        for floor in building.floors
                    ],
                }
                for building in buildings
            ],
        ),
    )


def transfer_project(
    db: Session, user: User, project: Project, data: ProjectTransfer
) -> Project:
    require_org_admin(db, project.organization_id, user)
    require_org_admin(db, data.organization_id, user)
    _check_team(db, data.organization_id, data.team_id, user)
    project.organization_id = data.organization_id
    project.team_id = data.team_id
    db.commit()
    db.refresh(project)
    return project


def create_project_share(
    db: Session, project: Project, data: ProjectShareCreate
) -> ProjectShare:
    row = ProjectShare(
        project_id=project.id,
        token=secrets.token_urlsafe(32),
        client_view=data.client_view,
        password_hash=hash_password(data.password) if data.password else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_project_shares(db: Session, project: Project) -> list[ProjectShare]:
    return list(
        db.scalars(
            select(ProjectShare)
            .where(ProjectShare.project_id == project.id)
            .order_by(ProjectShare.id)
        )
    )


def delete_project_share(db: Session, project: Project, share_id: int) -> None:
    share = db.scalar(
        select(ProjectShare).where(
            ProjectShare.id == share_id, ProjectShare.project_id == project.id
        )
    )
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share link not found")
    db.delete(share)
    db.commit()


def read_shared_project(
    db: Session, token: str, password: str | None
) -> dict:
    share = db.scalar(select(ProjectShare).where(ProjectShare.token == token))
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share link not found")
    if share.password_hash and (
        password is None or not verify_password(password, share.password_hash)
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "A valid share password is required")
    project = db.scalar(
        select(Project)
        .options(selectinload(Project.buildings).selectinload(Building.floors))
        .where(Project.id == share.project_id)
    )
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    buildings = []
    for building in project.buildings:
        floors = []
        for floor in building.floors:
            data = FloorPlanData.model_validate(floor.plan_data).model_dump()
            if share.client_view:
                visible_layer_ids = {
                    layer["id"]
                    for layer in data["layers"]
                    if layer["visible"] and layer["purpose"] in ("client", "architecture")
                }
                data["layers"] = [
                    layer
                    for layer in data["layers"]
                    if layer["id"] in visible_layer_ids
                ]
                data["rooms"] = [
                    room for room in data["rooms"] if room["layer_id"] in visible_layer_ids
                ]
                data["placements"] = [
                    {
                        **placement,
                        "circuit_id": None,
                        "device_id": None,
                        "channel_id": None,
                        "mounting_point_id": None,
                        "room_id": placement["room_id"]
                        if placement["room_id"]
                        in {room["id"] for room in data["rooms"]}
                        else None,
                        "bus_address": None,
                        "metadata": {},
                        "target_location": None,
                        "cable_type": None,
                    }
                    for placement in data["placements"]
                    if placement["layer_id"] in visible_layer_ids
                ]
                public_placement_ids = {item["id"] for item in data["placements"]}
                data["mounting_points"] = [
                    {
                        **point,
                        "placement_ids": [
                            item_id
                            for item_id in point["placement_ids"]
                            if item_id in public_placement_ids
                        ],
                    }
                    for point in data["mounting_points"]
                    if any(item_id in public_placement_ids for item_id in point["placement_ids"])
                ]
                data["free_canvas"] = [
                    item
                    for item in data["free_canvas"]
                    if item["layer_id"] in visible_layer_ids
                ]
                data["rcds"] = []
                data["circuits"] = []
                data["smart_devices"] = []
                data["electrical_components"] = []
                data["terminal_strips"] = []
                data["custom_components"] = []
                data["cabinet"] = {}
                data["prices"] = []
                data["measurements"] = []
                data["annotation"]["notes"] = ""
                data["annotation"]["presentation_mode"] = "client"
            floors.append({"id": floor.id, "name": floor.name, "plan_data": data})
        buildings.append({"name": building.name, "floors": floors})
    return {
        "name": project.name,
        "description": project.description,
        "buildings": buildings,
    }


def list_buildings(db: Session, project: Project) -> list[Building]:
    return list(
        db.scalars(
            select(Building)
            .options(selectinload(Building.floors))
            .where(Building.project_id == project.id)
            .order_by(Building.id)
        )
    )


def create_building(db: Session, project: Project, data: BuildingCreate) -> Building:
    building = Building(
        project_id=project.id,
        name=data.name,
        floors=[
            Floor(name=floor.name, sort_order=position)
            for position, floor in enumerate(data.floors)
        ],
    )
    db.add(building)
    db.commit()
    db.refresh(building)
    return building


def create_floor(db: Session, project: Project, building_id: int, data: FloorCreate) -> Floor:
    building = db.scalar(
        select(Building).where(Building.id == building_id, Building.project_id == project.id)
    )
    if building is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Building not found")
    sort_order = db.scalar(
        select(Floor.sort_order)
        .where(Floor.building_id == building.id)
        .order_by(Floor.sort_order.desc())
        .limit(1)
    )
    floor = Floor(name=data.name, sort_order=(sort_order + 1) if sort_order is not None else 0)
    building.floors.append(floor)
    db.commit()
    db.refresh(floor)
    return floor


def update_building(
    db: Session, project: Project, building_id: int, data: BuildingUpdate
) -> Building:
    building = db.scalar(
        select(Building).where(Building.id == building_id, Building.project_id == project.id)
    )
    if building is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Building not found")
    building.name = data.name
    db.commit()
    db.refresh(building)
    return building


def delete_building(db: Session, project: Project, building_id: int) -> None:
    building = db.scalar(
        select(Building).where(Building.id == building_id, Building.project_id == project.id)
    )
    if building is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Building not found")
    db.delete(building)
    db.commit()


def update_floor(db: Session, project: Project, floor_id: int, data: FloorUpdate) -> Floor:
    floor = _get_floor(db, project, floor_id)
    floor.name = data.name
    db.commit()
    db.refresh(floor)
    return floor


def duplicate_floor(db: Session, project: Project, floor_id: int) -> Floor:
    source = _get_floor(db, project, floor_id)
    building = source.building
    next_order = max((floor.sort_order for floor in building.floors), default=-1) + 1
    floor = Floor(
        name=f"{source.name} (copy)",
        sort_order=next_order,
        plan_data=FloorPlanData.model_validate(source.plan_data).model_dump(),
    )
    building.floors.append(floor)
    db.commit()
    db.refresh(floor)
    return floor


def delete_floor(db: Session, project: Project, floor_id: int) -> None:
    db.delete(_get_floor(db, project, floor_id))
    db.commit()


def _get_floor(db: Session, project: Project, floor_id: int) -> Floor:
    floor = db.scalar(
        select(Floor)
        .join(Building)
        .where(Floor.id == floor_id, Building.project_id == project.id)
    )
    if floor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Floor not found")
    return floor


def read_floor_plan_data(db: Session, project: Project, floor_id: int) -> dict:
    return _get_floor(db, project, floor_id).plan_data


def write_floor_plan_data(
    db: Session, project: Project, floor_id: int, data: FloorPlanData
) -> dict:
    floor = _get_floor(db, project, floor_id)
    floor.plan_data = data.model_dump()
    db.commit()
    db.refresh(floor)
    return floor.plan_data


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

from collections.abc import Mapping
from copy import deepcopy

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.project import Building, Floor, Project
from app.models.topology import Circuit, DistributionBoard, Load
from app.schemas.project import ElectricalCircuit, ResidualCurrentDevice
from app.schemas.topology import (
    BoardCreate,
    CircuitCreate,
    LoadCreate,
    TopologyImport,
)


def _validate_floor(db: Session, project: Project, floor_id: int | None) -> None:
    if floor_id is not None and not db.scalar(
        select(Floor.id)
        .join(Building)
        .where(Floor.id == floor_id, Building.project_id == project.id)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Floor not found")


def check_topology_revision(
    db: Session, project: Project, expected_revision: int, *, bump: bool = False
) -> int:
    current_revision = db.scalar(
        select(Project.topology_revision).where(Project.id == project.id).with_for_update()
    )
    if current_revision is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if current_revision != expected_revision:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Topology changed since it was read; reload before saving.",
        )
    if bump:
        db.query(Project).filter(Project.id == project.id).update(
            {Project.topology_revision: current_revision + 1}
        )
        db.flush()
    return current_revision + (1 if bump else 0)


def lock_topology_snapshot(db: Session, project: Project) -> int:
    """Lock the project revision before reading topology rows for one response."""
    revision = db.scalar(
        select(Project.topology_revision).where(Project.id == project.id).with_for_update()
    )
    if revision is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return revision


def migrate_and_lock_snapshot(db: Session, project: Project) -> int:
    """Commit any legacy migration, then lock and return the revision for a read."""
    if ensure_legacy_topology(db, project):
        db.commit()
    return lock_topology_snapshot(db, project)


def bump_topology_revision(db: Session, project: Project) -> int:
    """Serialize on the project row and invalidate every previously read revision."""
    revision = lock_topology_snapshot(db, project) + 1
    db.query(Project).filter(Project.id == project.id).update({Project.topology_revision: revision})
    db.flush()
    return revision


def parse_if_match(value: str | None) -> int:
    if value is None:
        raise HTTPException(
            status.HTTP_428_PRECONDITION_REQUIRED,
            "If-Match topology revision is required.",
        )
    try:
        return int(value.strip().strip('"'))
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "If-Match must contain a numeric topology revision.",
        ) from exc


def get_board(db: Session, project: Project, board_id: int) -> DistributionBoard:
    board = db.scalar(
        select(DistributionBoard).where(
            DistributionBoard.id == board_id, DistributionBoard.project_id == project.id
        )
    )
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Distribution board not found")
    return board


def get_circuit(db: Session, project: Project, circuit_id: int) -> Circuit:
    circuit = db.scalar(
        select(Circuit)
        .join(DistributionBoard)
        .where(Circuit.id == circuit_id, DistributionBoard.project_id == project.id)
    )
    if circuit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Circuit not found")
    return circuit


def get_load(db: Session, project: Project, load_id: int) -> Load:
    load = db.scalar(
        select(Load)
        .join(Circuit)
        .join(DistributionBoard)
        .where(Load.id == load_id, DistributionBoard.project_id == project.id)
    )
    if load is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Load not found")
    return load


def list_boards(db: Session, project: Project) -> list[DistributionBoard]:
    return list(
        db.scalars(
            select(DistributionBoard)
            .where(DistributionBoard.project_id == project.id)
            .order_by(DistributionBoard.id)
        )
    )


def list_project_placements(db: Session, project: Project) -> list[dict]:
    if ensure_legacy_topology(db, project):
        db.commit()
    floors = db.scalars(
        select(Floor)
        .join(Building)
        .where(Building.project_id == project.id)
        .order_by(Building.id, Floor.sort_order, Floor.id)
    )
    return [
        {
            "id": placement["id"],
            "floor_id": floor.id,
            "floor_name": floor.name,
            "label": placement.get("label") or placement.get("kind") or placement["id"],
        }
        for floor in floors
        for placement in (floor.plan_data or {}).get("placements", [])
        if placement.get("id")
    ]


def create_board(db: Session, project: Project, data: BoardCreate) -> DistributionBoard:
    _validate_floor(db, project, data.floor_id)
    board = DistributionBoard(project_id=project.id, **data.model_dump())
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


def list_circuits(db: Session, board: DistributionBoard) -> list[Circuit]:
    return list(
        db.scalars(select(Circuit).where(Circuit.board_id == board.id).order_by(Circuit.id))
    )


def create_circuit(db: Session, board: DistributionBoard, data: CircuitCreate) -> Circuit:
    _validate_source_id(db, board, data.source_id)
    circuit = Circuit(board_id=board.id, **data.model_dump())
    db.add(circuit)
    db.commit()
    db.refresh(circuit)
    if circuit.source_id is None:
        circuit.source_id = f"circuit-{circuit.id}"
        db.commit()
        db.refresh(circuit)
    return circuit


def list_loads(db: Session, circuit: Circuit) -> list[Load]:
    return list(db.scalars(select(Load).where(Load.circuit_id == circuit.id).order_by(Load.id)))


def create_load(db: Session, project: Project, circuit: Circuit, data: LoadCreate) -> Load:
    _validate_floor(db, project, data.floor_id)
    floor = _resolve_placement_floor(db, project, data.placement_id, data.floor_id)
    if data.placement_id is not None:
        _ensure_placement_not_linked(db, project, data.placement_id, exclude_load_id=None)
    if data.placement_id is not None and circuit.source_id is None:
        circuit.source_id = f"circuit-{circuit.id}"
    load = Load(
        circuit_id=circuit.id,
        **{**data.model_dump(), "floor_id": floor.id if floor else data.floor_id},
    )
    db.add(load)
    if data.placement_id and circuit.source_id:
        _set_placement_circuit(db, floor, data.placement_id, circuit.source_id)
    db.commit()
    db.refresh(load)
    return load


def update_board(
    db: Session, project: Project, board: DistributionBoard, data: BoardCreate
) -> DistributionBoard:
    _validate_floor(db, project, data.floor_id)
    for key, value in data.model_dump().items():
        setattr(board, key, value)
    db.commit()
    db.refresh(board)
    return board


def update_circuit(db: Session, project: Project, circuit: Circuit, data: CircuitCreate) -> Circuit:
    board = db.get(DistributionBoard, circuit.board_id)
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Distribution board not found")
    old_source_id = circuit.source_id
    new_source_id = data.source_id or old_source_id
    _validate_source_id(db, board, new_source_id, exclude_id=circuit.id)
    if data.source_id is None and old_source_id is not None:
        circuit_data = data.model_dump()
        circuit_data["source_id"] = old_source_id
    else:
        circuit_data = data.model_dump()
    for key, value in circuit_data.items():
        setattr(circuit, key, value)
    if old_source_id and new_source_id and old_source_id != new_source_id:
        _rewrite_project_circuit_refs(db, project.id, {old_source_id: new_source_id})
    db.commit()
    db.refresh(circuit)
    return circuit


def update_load(db: Session, project: Project, load: Load, data: LoadCreate) -> Load:
    _validate_floor(db, project, data.floor_id)
    circuit = db.get(Circuit, load.circuit_id)
    if circuit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Circuit not found")
    old_placement_id = load.placement_id
    old_floor_id = load.floor_id
    floor = _resolve_placement_floor(db, project, data.placement_id, data.floor_id)
    if data.placement_id is not None:
        _ensure_placement_not_linked(db, project, data.placement_id, exclude_load_id=load.id)
    for key, value in data.model_dump().items():
        setattr(load, key, value)
    load.floor_id = floor.id if floor else data.floor_id
    if old_placement_id and (
        old_placement_id != data.placement_id or old_floor_id != load.floor_id
    ):
        _clear_placement_circuit_if_unused(db, circuit, old_floor_id, old_placement_id)
    if data.placement_id:
        if circuit.source_id is None:
            circuit.source_id = f"circuit-{circuit.id}"
        _set_placement_circuit(db, floor, data.placement_id, circuit.source_id)
    db.commit()
    db.refresh(load)
    return load


def delete_item(
    db: Session,
    item: DistributionBoard | Circuit | Load,
    project: Project | None = None,
) -> None:
    if isinstance(item, DistributionBoard):
        project_id = item.project_id
        circuits = list_circuits(db, item)
        if any(
            load.placement_id is None for circuit in circuits for load in list_loads(db, circuit)
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A board with manual or disconnected loads cannot be removed.",
            )
        source_ids = {c.source_id for c in circuits if c.source_id}
        _rewrite_project_circuit_refs(db, project_id, {}, source_ids)
    elif isinstance(item, Circuit):
        if any(load.placement_id is None for load in list_loads(db, item)):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A circuit with manual or disconnected loads cannot be removed.",
            )
        board = db.get(DistributionBoard, item.board_id)
        if board is not None and item.source_id:
            _rewrite_project_circuit_refs(db, board.project_id, {}, {item.source_id})
        for load in list_loads(db, item):
            _clear_placement_circuit_if_unused(
                db, item, load.floor_id, load.placement_id, excluding_load_id=load.id
            )
    elif isinstance(item, Load):
        circuit = db.get(Circuit, item.circuit_id)
        if circuit is not None:
            _clear_placement_circuit_if_unused(
                db, circuit, item.floor_id, item.placement_id, excluding_load_id=item.id
            )
    db.delete(item)
    db.commit()


def _validate_source_id(
    db: Session,
    board: DistributionBoard,
    source_id: str | None,
    exclude_id: int | None = None,
) -> None:
    if source_id is None:
        return
    statement = (
        select(Circuit.id)
        .join(DistributionBoard)
        .where(
            DistributionBoard.project_id == board.project_id,
            Circuit.source_id == source_id,
        )
    )
    if exclude_id is not None:
        statement = statement.where(Circuit.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Circuit source_id must be unique within the project",
        )


def _resolve_placement_floor(
    db: Session,
    project: Project,
    placement_id: str | None,
    floor_id: int | None,
) -> Floor | None:
    if placement_id is None:
        return None
    floors = list(
        db.scalars(
            select(Floor).join(Building).where(Building.project_id == project.id).order_by(Floor.id)
        )
    )
    matching = [
        floor
        for floor in floors
        if any(
            placement.get("id") == placement_id
            for placement in (floor.plan_data or {}).get("placements", [])
        )
    ]
    if floor_id is not None:
        matching = [floor for floor in matching if floor.id == floor_id]
    if not matching:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Floor-plan placement not found")
    if len(matching) > 1:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Placement ID is ambiguous; provide a floor_id",
        )
    return matching[0]


def _ensure_placement_not_linked(
    db: Session,
    project: Project,
    placement_id: str,
    exclude_load_id: int | None,
) -> None:
    statement = (
        select(Load.id)
        .join(Circuit)
        .join(DistributionBoard)
        .where(
            DistributionBoard.project_id == project.id,
            Load.placement_id == placement_id,
        )
    )
    if exclude_load_id is not None:
        statement = statement.where(Load.id != exclude_load_id)
    if db.scalar(statement.limit(1)) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Floor-plan placement is already linked to a circuit",
        )


def _set_placement_circuit(
    db: Session, floor: Floor | None, placement_id: str, circuit_source_id: str
) -> None:
    if floor is None:
        return
    plan = deepcopy(floor.plan_data or {})
    placements = [dict(item) for item in plan.get("placements", [])]
    for placement in placements:
        if placement.get("id") == placement_id:
            placement["circuit_id"] = circuit_source_id
            break
    plan["placements"] = placements
    floor.plan_data = plan


def _clear_placement_circuit_if_unused(
    db: Session,
    circuit: Circuit,
    floor_id: int | None,
    placement_id: str | None,
    excluding_load_id: int | None = None,
) -> None:
    if floor_id is None or placement_id is None:
        return
    board = db.get(DistributionBoard, circuit.board_id)
    if board is None or circuit.source_id is None:
        return
    remaining = select(Load.id).where(
        Load.floor_id == floor_id,
        Load.placement_id == placement_id,
    )
    if excluding_load_id is not None:
        remaining = remaining.where(Load.id != excluding_load_id)
    if db.scalar(remaining.limit(1)) is not None:
        return
    floor = db.get(Floor, floor_id)
    if floor is None:
        return
    plan = deepcopy(floor.plan_data or {})
    placements = [dict(item) for item in plan.get("placements", [])]
    changed = False
    for placement in placements:
        if placement.get("id") == placement_id and placement.get("circuit_id") == circuit.source_id:
            placement["circuit_id"] = None
            changed = True
    if changed:
        plan["placements"] = placements
        floor.plan_data = plan


def _rewrite_project_circuit_refs(
    db: Session,
    project_id: int,
    id_map: dict[str, str],
    removed_ids: set[str] | None = None,
) -> None:
    removed_ids = removed_ids or set()
    floors = db.scalars(select(Floor).join(Building).where(Building.project_id == project_id))
    for floor in floors:
        plan = deepcopy(floor.plan_data or {})
        _rewrite_circuit_refs(plan, id_map)
        for placement in plan.get("placements", []):
            if placement.get("circuit_id") in removed_ids:
                placement["circuit_id"] = None
        for device in plan.get("smart_devices", []):
            if device.get("circuit_id") in removed_ids:
                device["circuit_id"] = None
            for channel in device.get("channels", []):
                if channel.get("circuit_id") in removed_ids:
                    channel["circuit_id"] = None
        for strip in plan.get("terminal_strips", []):
            strip["circuit_ids"] = [
                value for value in strip.get("circuit_ids", []) if value not in removed_ids
            ]
        for component in plan.get("electrical_components", []):
            component["circuit_ids"] = [
                value for value in component.get("circuit_ids", []) if value not in removed_ids
            ]
        plan["measurements"] = [
            item
            for item in plan.get("measurements", [])
            if item.get("circuit_id") not in removed_ids
        ]
        floor.plan_data = plan


def _floor_reference_map(
    db: Session, project: Project
) -> tuple[dict[int, tuple[int, int]], dict[tuple[int, int], Floor]]:
    buildings = list(
        db.scalars(select(Building).where(Building.project_id == project.id).order_by(Building.id))
    )
    by_id: dict[int, tuple[int, int]] = {}
    by_reference: dict[tuple[int, int], Floor] = {}
    for building_index, building in enumerate(buildings):
        floors = list(
            db.scalars(
                select(Floor)
                .where(Floor.building_id == building.id)
                .order_by(Floor.sort_order, Floor.id)
            )
        )
        for floor_index, floor in enumerate(floors):
            reference = (building_index, floor_index)
            by_id[floor.id] = reference
            by_reference[reference] = floor
    return by_id, by_reference


def export_topology(db: Session, project: Project) -> dict:
    ensure_legacy_topology(db, project)
    floor_refs, _ = _floor_reference_map(db, project)
    floor_by_id: dict[int, Floor] = {}
    for floor_id in floor_refs:
        floor = db.get(Floor, floor_id)
        if floor is not None:
            floor_by_id[floor.id] = floor
    placement_floors: dict[str, list[int]] = {}
    for floor in floor_by_id.values():
        for placement in (floor.plan_data or {}).get("placements", []):
            if placement.get("id"):
                placement_floors.setdefault(placement["id"], []).append(floor.id)
    exported_boards = []
    for board in list_boards(db, project):
        circuits = list_circuits(db, board)
        exported_circuits = []
        for circuit in circuits:
            exported_loads = []
            for load in list_loads(db, circuit):
                floor_id = load.floor_id
                if load.placement_id is not None:
                    matching_floor_ids = placement_floors.get(load.placement_id, [])
                    if floor_id is None:
                        if len(matching_floor_ids) == 1:
                            floor_id = matching_floor_ids[0]
                        elif matching_floor_ids:
                            raise _incomplete_topology(
                                f"Load {load.id} has no unambiguous placement floor"
                            )
                    elif floor_id not in matching_floor_ids:
                        raise _incomplete_topology(
                            f"Load {load.id} placement does not belong to its floor"
                        )
                floor_ref = floor_refs.get(floor_id) if floor_id is not None else None
                exported_loads.append(
                    {
                        "name": load.name,
                        "floor_ref": floor_ref,
                        "placement_id": load.placement_id,
                        "data": load.data or {},
                    }
                )
            exported_circuits.append(
                {
                    "name": circuit.name,
                    "source_id": circuit.source_id,
                    "data": circuit.data or {},
                    "loads": exported_loads,
                }
            )
        floor_ref = floor_refs.get(board.floor_id) if board.floor_id is not None else None
        exported_boards.append(
            {
                "name": board.name,
                "kind": board.kind,
                "floor_ref": floor_ref,
                "data": board.data or {},
                "circuits": exported_circuits,
            }
        )
    return {"boards": exported_boards}


def import_topology(
    db: Session,
    project: Project,
    topology_data: TopologyImport | None,
    floors: dict[tuple[int, int], Floor],
) -> None:
    if topology_data is None:
        return
    for board_data in topology_data.boards:
        board_floor = _resolve_floor_ref(floors, board_data.floor_ref)
        board = DistributionBoard(
            project_id=project.id,
            floor_id=board_floor.id if board_floor else None,
            name=board_data.name,
            kind=board_data.kind,
            data=board_data.data,
        )
        db.add(board)
        db.flush()
        for circuit_data in board_data.circuits:
            circuit = Circuit(
                board_id=board.id,
                name=circuit_data.name,
                source_id=circuit_data.source_id,
                data=circuit_data.data,
            )
            db.add(circuit)
            db.flush()
            for load_data in circuit_data.loads:
                load_floor = _resolve_floor_ref(floors, load_data.floor_ref)
                if load_data.placement_id:
                    placement_ids = (
                        {
                            item.get("id")
                            for item in (load_floor.plan_data or {}).get("placements", [])
                        }
                        if load_floor is not None
                        else set()
                    )
                    if load_floor is not None and load_data.placement_id not in placement_ids:
                        raise HTTPException(
                            status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Topology load references a placement outside the imported project",
                        )
                db.add(
                    Load(
                        circuit_id=circuit.id,
                        floor_id=load_floor.id if load_floor else None,
                        name=load_data.name,
                        placement_id=load_data.placement_id,
                        data=load_data.data,
                    )
                )


def ensure_legacy_topology(db: Session, project: Project) -> bool:
    """Move pre-topology floor-plan circuits into the project-scoped topology tables."""
    lock_topology_snapshot(db, project)
    floors = list(
        db.scalars(
            select(Floor)
            .join(Building)
            .where(Building.project_id == project.id)
            .order_by(Building.id, Floor.sort_order, Floor.id)
            .execution_options(populate_existing=True)
        )
    )
    changed = _remap_duplicate_project_placements(db, floors)
    placements: dict[str, tuple[Floor, dict]] = {}
    for floor in floors:
        for placement in (floor.plan_data or {}).get("placements", []):
            placement_id = placement.get("id")
            if placement_id:
                placements[placement_id] = (floor, placement)
    seen_rcd_ids = {
        rcd.get("id")
        for board in list_boards(db, project)
        for rcd in (board.data or {}).get("rcds", [])
        if rcd.get("id")
    }
    seen_rcd_ids.update(
        circuit.data.get("rcd_id")
        for board in list_boards(db, project)
        for circuit in list_circuits(db, board)
        if (circuit.data or {}).get("rcd_id")
    )
    seen_circuit_ids = {
        circuit.source_id
        for board in list_boards(db, project)
        for circuit in list_circuits(db, board)
        if circuit.source_id
    }
    for floor in floors:
        floor_data = deepcopy(floor.plan_data or {})
        legacy_rcds = floor_data.get("rcds") or []
        legacy_circuits = floor_data.get("circuits") or []
        if not legacy_rcds and not legacy_circuits:
            continue
        rcd_id_map: dict[str, str] = {}
        circuit_id_map: dict[str, str] = {}
        for rcd in legacy_rcds:
            original = rcd["id"]
            candidate = _unique_legacy_id(original, floor.id, seen_rcd_ids)
            rcd_id_map[original] = candidate
            seen_rcd_ids.add(candidate)
            rcd["id"] = candidate
        for circuit in legacy_circuits:
            original = circuit["id"]
            candidate = _unique_legacy_id(original, floor.id, seen_circuit_ids)
            circuit_id_map[original] = candidate
            seen_circuit_ids.add(candidate)
            circuit["id"] = candidate
            if circuit.get("rcd_id") in rcd_id_map:
                circuit["rcd_id"] = rcd_id_map[circuit["rcd_id"]]
        for rcd in legacy_rcds:
            if rcd.get("upstream_id") in rcd_id_map:
                rcd["upstream_id"] = rcd_id_map[rcd["upstream_id"]]
        _rewrite_circuit_refs(floor_data, circuit_id_map)
        board_data = {
            "cabinet": floor_data.get("cabinet", {}),
            "rcds": legacy_rcds,
        }
        board = DistributionBoard(
            project_id=project.id,
            floor_id=floor.id,
            name=(floor_data.get("cabinet") or {}).get("name")
            or f"{floor.name} distribution board",
            kind="sub",
            data=board_data,
        )
        db.add(board)
        db.flush()
        for circuit_data in legacy_circuits:
            source_id = circuit_data["id"]
            circuit = Circuit(
                board_id=board.id,
                name=circuit_data["name"],
                source_id=source_id,
                data={
                    key: value for key, value in circuit_data.items() if key not in {"id", "loads"}
                },
            )
            db.add(circuit)
            db.flush()
            for placement_id in circuit_data.get("loads", []):
                placement = placements.get(placement_id)
                load_floor, placement_data = placement if placement else (None, None)
                db.add(
                    Load(
                        circuit_id=circuit.id,
                        floor_id=load_floor.id if load_floor else None,
                        placement_id=placement_id,
                        name=(
                            placement_data.get("label")
                            if placement_data is not None
                            else placement_id
                        )
                        or placement_id,
                        data={},
                    )
                )
        floor_data["rcds"] = []
        floor_data["circuits"] = []
        floor.plan_data = floor_data
        changed = True
    if changed:
        db.query(Project).filter(Project.id == project.id).update(
            {Project.topology_revision: Project.topology_revision + 1}
        )
        db.flush()
    return changed


def _remap_duplicate_project_placements(db: Session, floors: list[Floor]) -> bool:
    seen: set[str] = set()
    changed = False
    for floor in floors:
        floor_data = deepcopy(floor.plan_data or {})
        id_map: dict[str, str] = {}
        for placement in floor_data.get("placements", []):
            placement_id = placement.get("id")
            if not placement_id:
                continue
            unique_id = _unique_legacy_id(placement_id, floor.id, seen)
            if unique_id != placement_id:
                id_map[placement_id] = unique_id
                placement["id"] = unique_id
                changed = True
            seen.add(unique_id)
        if id_map:
            _rewrite_placement_refs(floor_data, id_map)
            floor.plan_data = floor_data
            for old_id, new_id in id_map.items():
                db.query(Load).filter(
                    Load.floor_id == floor.id,
                    Load.placement_id == old_id,
                ).update({Load.placement_id: new_id})
    return changed


def _rewrite_placement_refs(plan_data: dict, id_map: dict[str, str]) -> None:
    for circuit in plan_data.get("circuits", []):
        circuit["loads"] = [id_map.get(value, value) for value in circuit.get("loads", [])]
    for point in plan_data.get("mounting_points", []):
        point["placement_ids"] = [
            id_map.get(value, value) for value in point.get("placement_ids", [])
        ]
    for device in plan_data.get("smart_devices", []):
        for channel in device.get("channels", []):
            channel["load_ids"] = [
                id_map.get(value, value) for value in channel.get("load_ids", [])
            ]


def _unique_legacy_id(original: str, floor_id: int, used: set[str]) -> str:
    if original not in used:
        return original
    suffix = f"-legacy-{floor_id}"
    candidate = f"{original[: 80 - len(suffix)]}{suffix}"
    serial = 2
    while candidate in used:
        numbered_suffix = f"{suffix}-{serial}"
        candidate = f"{original[: 80 - len(numbered_suffix)]}{numbered_suffix}"
        serial += 1
    return candidate


def _rewrite_circuit_refs(plan_data: dict, id_map: dict[str, str]) -> None:
    for placement in plan_data.get("placements", []):
        if placement.get("circuit_id") in id_map:
            placement["circuit_id"] = id_map[placement["circuit_id"]]
    for device in plan_data.get("smart_devices", []):
        if device.get("circuit_id") in id_map:
            device["circuit_id"] = id_map[device["circuit_id"]]
        for channel in device.get("channels", []):
            if channel.get("circuit_id") in id_map:
                channel["circuit_id"] = id_map[channel["circuit_id"]]
    for strip in plan_data.get("terminal_strips", []):
        strip["circuit_ids"] = [id_map.get(value, value) for value in strip.get("circuit_ids", [])]
    for component in plan_data.get("electrical_components", []):
        component["circuit_ids"] = [
            id_map.get(value, value) for value in component.get("circuit_ids", [])
        ]
    for measurement in plan_data.get("measurements", []):
        if measurement.get("circuit_id") in id_map:
            measurement["circuit_id"] = id_map[measurement["circuit_id"]]


def project_plan_topology(
    db: Session, project: Project
) -> tuple[list[dict], list[dict], list[str]]:
    rcds: list[dict] = []
    circuits: list[dict] = []
    known_rcd_ids: set[str] = set()
    ambiguous_rcd_ids: set[str] = set()
    warnings: list[str] = []
    placement_floors: dict[str, list[Floor]] = {}
    for floor in db.scalars(select(Floor).join(Building).where(Building.project_id == project.id)):
        for placement in (floor.plan_data or {}).get("placements", []):
            if placement.get("id"):
                placement_floors.setdefault(placement["id"], []).append(floor)
    for board in list_boards(db, project):
        board_rcds = (board.data or {}).get("rcds", [])
        if not isinstance(board_rcds, list):
            warnings.append(f"Board {board.name}: RCD metadata is invalid.")
            board_rcds = []
        board_circuits = list_circuits(db, board)
        for rcd in board_rcds:
            if not isinstance(rcd, Mapping):
                warnings.append(f"Board {board.name}: RCD metadata is invalid.")
                continue
            required = {"id", "name", "rated_current_ma", "poles", "type"}
            if not required.issubset(rcd):
                warnings.append(f"Board {board.name}: RCD metadata is incomplete.")
                continue
            try:
                validated_rcd = ResidualCurrentDevice.model_validate(
                    {**rcd, "board_id": board.id}
                ).model_dump()
            except ValidationError:
                warnings.append(f"Board {board.name}: RCD metadata is invalid.")
                continue
            rcd_id = validated_rcd["id"]
            if rcd_id in known_rcd_ids:
                ambiguous_rcd_ids.add(rcd_id)
                warnings.append(
                    f"Project: duplicate RCD reference {rcd_id}; associated circuits hidden."
                )
                continue
            rcds.append(validated_rcd)
            known_rcd_ids.add(rcd_id)
        for circuit in board_circuits:
            data = dict(circuit.data or {})
            required = {
                "rcd_id",
                "breaker_type",
                "rated_current_a",
                "poles",
                "cable",
                "supply",
            }
            if circuit.source_id is None or not required.issubset(data):
                warnings.append(
                    f"Circuit {circuit.name}: incomplete schematic data; circuit hidden."
                )
                continue
            circuit_id = circuit.source_id
            try:
                validated_circuit = ElectricalCircuit.model_validate(
                    {
                        **data,
                        "id": circuit_id,
                        "name": circuit.name,
                        "loads": [],
                    }
                ).model_dump()
            except ValidationError:
                warnings.append(f"Circuit {circuit.name}: invalid schematic data; circuit hidden.")
                continue
            if validated_circuit["rcd_id"] in ambiguous_rcd_ids:
                continue
            if validated_circuit["rcd_id"] not in known_rcd_ids:
                warnings.append(
                    f"Circuit {circuit.name}: protection device is missing or incomplete; "
                    "circuit hidden."
                )
                continue
            load_ids: list[str] = []
            for load in list_loads(db, circuit):
                if load.placement_id is None:
                    continue
                matching_floors = placement_floors.get(load.placement_id, [])
                if load.floor_id is not None:
                    matching_floors = [
                        floor for floor in matching_floors if floor.id == load.floor_id
                    ]
                if len(matching_floors) != 1:
                    warnings.append(
                        f"Circuit {circuit.name}: a linked floor-plan placement is "
                        "unresolved and was omitted."
                    )
                    continue
                if load.placement_id in load_ids:
                    warnings.append(f"Circuit {circuit.name}: duplicate placement link omitted.")
                    continue
                load_ids.append(load.placement_id)
            validated_circuit["loads"] = load_ids
            circuits.append(validated_circuit)
    rcds = [rcd for rcd in rcds if rcd["id"] not in ambiguous_rcd_ids]
    circuits = [circuit for circuit in circuits if circuit["rcd_id"] not in ambiguous_rcd_ids]
    return rcds, circuits, warnings


def _incomplete_topology(message: str) -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        f"{message}; provide complete, valid board/RCD/circuit data before using "
        "the floor-plan schematic view.",
    )


def _placement_map(
    db: Session, project: Project, edited_floor: Floor | None, edited_plan
) -> dict[str, tuple[Floor, dict]]:
    placements = {}
    floors = list(db.scalars(select(Floor).join(Building).where(Building.project_id == project.id)))
    for floor in floors:
        floor_placements = (
            edited_plan.placements
            if edited_floor is not None and floor.id == edited_floor.id
            else (floor.plan_data or {}).get("placements", [])
        )
        for placement in floor_placements:
            placement_id = placement.id if hasattr(placement, "id") else placement.get("id")
            if placement_id:
                if placement_id in placements:
                    raise HTTPException(
                        status.HTTP_422_UNPROCESSABLE_ENTITY,
                        "Floor-plan symbol IDs must be unique within the project",
                    )
                placements[placement_id] = (
                    floor,
                    placement.model_dump() if hasattr(placement, "model_dump") else placement,
                )
    return placements


def _validate_project_placements(circuits: list, placements: dict[str, tuple[Floor, dict]]) -> None:
    load_ids = [load_id for circuit in circuits for load_id in circuit.loads]
    referenced_ids = set(load_ids)
    if len(load_ids) != len(referenced_ids):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A floor-plan symbol may be assigned to only one circuit, once",
        )
    if not referenced_ids.issubset(placements):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Circuit loads must reference floor-plan symbols in this project",
        )


def replace_project_plan_topology(db: Session, project: Project, data, edited_floor: Floor) -> None:
    """Reconcile the submitted projection while preserving incomplete topology."""
    placements = _placement_map(db, project, edited_floor, data)
    _validate_project_placements(data.circuits, placements)
    circuit_by_placement = {
        placement_id: circuit.id
        for circuit in data.circuits
        for placement_id in circuit.loads
    }
    for placement in data.placements:
        assigned = circuit_by_placement.get(placement.id)
        if placement.circuit_id is not None and placement.circuit_id != assigned:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Floor-plan symbol circuit assignment contradicts the circuit load lists",
            )
        placement.circuit_id = assigned
    boards = list_boards(db, project)
    old_rcds, old_circuits, _ = project_plan_topology(db, project)
    old_circuit_ids = {row["id"] for row in old_circuits}
    submitted_circuit_ids = {row.id for row in data.circuits}
    removed_circuit_ids = old_circuit_ids - submitted_circuit_ids
    old_load_ids = {row["id"]: set(row["loads"]) for row in old_circuits}
    all_projected_load_ids = [
        placement_id for circuit_loads in old_load_ids.values() for placement_id in circuit_loads
    ]
    if len(all_projected_load_ids) != len(set(all_projected_load_ids)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A floor-plan placement is linked to multiple circuits; resolve the duplicate before saving.",
        )

    circuits_by_source = {
        circuit.source_id: circuit
        for board in boards
        for circuit in list_circuits(db, board)
        if circuit.source_id in removed_circuit_ids
    }
    for source_id in removed_circuit_ids:
        circuit = circuits_by_source.get(source_id)
        if circuit is None:
            continue
        loads = list_loads(db, circuit)
        if any(
            load.placement_id is None or load.placement_id not in old_load_ids.get(source_id, set())
            for load in loads
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Circuit {source_id} has manual or unresolved loads and cannot be removed.",
            )
        for load in loads:
            db.delete(load)
        db.delete(circuit)
    if removed_circuit_ids:
        db.flush()
        _rewrite_project_circuit_refs(db, project.id, {}, removed_circuit_ids)

    submitted_load_ids = {
        placement_id for circuit in data.circuits for placement_id in circuit.loads
    }
    removed_load_ids = set().union(*old_load_ids.values()) - submitted_load_ids
    for placement_id in removed_load_ids:
        linked_loads = list(
            db.scalars(
                select(Load)
                .join(Circuit)
                .join(DistributionBoard)
                .where(
                    DistributionBoard.project_id == project.id,
                    Load.placement_id == placement_id,
                )
            )
        )
        if len(linked_loads) > 1:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A floor-plan placement has multiple topology links; resolve the duplicate before saving.",
            )
        if not linked_loads:
            continue
        load = linked_loads[0]
        circuit = db.get(Circuit, load.circuit_id)
        if circuit is None or circuit.source_id in removed_circuit_ids:
            continue
        db.delete(load)
        db.flush()
        _clear_placement_circuit_if_unused(db, circuit, load.floor_id, placement_id)

    old_rcd_ids = {row["id"] for row in old_rcds}
    submitted_rcd_ids = {row.id for row in data.rcds}
    removed_rcd_ids = old_rcd_ids - submitted_rcd_ids
    for board in boards:
        board_circuits = list_circuits(db, board)
        remaining_rcd_ids = {
            (circuit.data or {}).get("rcd_id")
            for circuit in board_circuits
            if circuit.source_id not in removed_circuit_ids
        }
        unsafe = removed_rcd_ids & remaining_rcd_ids
        if unsafe:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A residual-current device still protects one or more circuits.",
            )
        board_data = dict(board.data or {})
        prior = list(board_data.get("rcds", []))
        retained = [item for item in prior if item.get("id") not in removed_rcd_ids]
        if retained != prior:
            board_data["rcds"] = retained
            board.data = board_data

    if not boards and (data.rcds or data.circuits):
        board = DistributionBoard(
            project_id=project.id,
            name="Distribution board",
            kind="main",
            data={},
        )
        db.add(board)
        db.flush()
        boards = [board]
    board_by_rcd: dict[str, DistributionBoard] = {}
    boards_by_id = {board.id: board for board in boards}
    for board in boards:
        for rcd in (board.data or {}).get("rcds", []):
            if rcd.get("id"):
                board_by_rcd[rcd["id"]] = board
    default_board = boards[0] if len(boards) == 1 else None
    for rcd in data.rcds:
        existing_board = board_by_rcd.get(rcd.id)
        selected_board = boards_by_id.get(rcd.board_id) if rcd.board_id is not None else None
        if rcd.board_id is not None and selected_board is None:
            raise _incomplete_topology(f"RCD {rcd.id} references an unknown board")
        if existing_board is not None and selected_board is not None and existing_board.id != selected_board.id:
            raise _incomplete_topology(f"RCD {rcd.id} cannot be moved between boards in this editor")
        candidate_board = selected_board or default_board
        if existing_board is None and candidate_board is not None:
            board_by_rcd[rcd.id] = candidate_board
    for rcd in data.rcds:
        board = board_by_rcd.get(rcd.id)
        if board is None:
            raise _incomplete_topology(f"RCD {rcd.id} is not assigned to a board")
        board_data = dict(board.data or {})
        previous = list(board_data.get("rcds", []))
        existing_rcd = next(
            (index for index, value in enumerate(previous) if value.get("id") == rcd.id),
            None,
        )
        if existing_rcd is None:
            previous.append(rcd.model_dump(exclude={"board_id"}))
        else:
            previous[existing_rcd] = rcd.model_dump(exclude={"board_id"})
        board_data["rcds"] = previous
        board.data = board_data
    existing_rows = [
        circuit for board in boards for circuit in list_circuits(db, board) if circuit.source_id
    ]
    existing = {circuit.source_id: circuit for circuit in existing_rows}
    if len(existing) != len(existing_rows):
        raise _incomplete_topology("Project contains duplicate circuit source IDs")
    existing_loads_by_placement = {
        load.placement_id: load
        for circuit in existing_rows
        for load in list_loads(db, circuit)
        if load.placement_id is not None
    }
    submitted_ids: set[str] = set()
    for circuit_data in data.circuits:
        board = board_by_rcd.get(circuit_data.rcd_id) or default_board
        if board is None:
            raise _incomplete_topology(
                f"Circuit {circuit_data.id} is not assigned to a project board"
            )
        if circuit_data.id in submitted_ids:
            raise _incomplete_topology(
                f"Project contains duplicate circuit source ID {circuit_data.id}"
            )
        submitted_ids.add(circuit_data.id)
        circuit = existing.get(circuit_data.id)
        if circuit is None:
            _validate_source_id(db, board, circuit_data.id)
            circuit = Circuit(board_id=board.id, name=circuit_data.name, source_id=circuit_data.id)
            db.add(circuit)
        else:
            circuit.board_id = board.id
            circuit.name = circuit_data.name
        circuit.source_id = circuit_data.id
        circuit.data = circuit_data.model_dump(exclude={"id", "name", "loads"})
        db.flush()
        for placement_id in circuit_data.loads:
            floor, placement = placements[placement_id]
            load = existing_loads_by_placement.get(placement_id)
            if load is not None:
                load.circuit_id = circuit.id
            if load is None:
                load = Load(
                    circuit_id=circuit.id,
                    placement_id=placement_id,
                    name=placement.get("label") or placement_id,
                    data={},
                )
                db.add(load)
            load.floor_id = floor.id
            if floor.id != edited_floor.id:
                _set_placement_circuit(db, floor, placement_id, circuit_data.id)


def _resolve_floor_ref(
    floors: dict[tuple[int, int], Floor], floor_ref: tuple[int, int] | None
) -> Floor | None:
    if floor_ref is None:
        return None
    floor = floors.get(floor_ref)
    if floor is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Topology floor reference is outside the imported project",
        )
    return floor

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.topology import (
    BoardCreate,
    BoardRead,
    CircuitCreate,
    CircuitRead,
    LoadCreate,
    LoadRead,
    TopologyPlacementRead,
)
from app.services import topology
from app.services.access import require_project_access

router = APIRouter(prefix="/projects/{project_id}", tags=["distribution topology"])


def _check_write_revision(
    project_id: int,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    project = require_project_access(db, project_id, user)
    expected = topology.parse_if_match(if_match)
    revision = topology.check_topology_revision(db, project, expected, bump=True)
    response.headers["X-Topology-Revision"] = str(revision)


@router.get("/boards", response_model=list[BoardRead])
def boards(
    project_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    revision = topology.migrate_and_lock_snapshot(db, project)
    response.headers["X-Topology-Revision"] = str(revision)
    return topology.list_boards(db, project)


@router.get(
    "/topology/placements",
    response_model=list[TopologyPlacementRead],
)
def project_placements(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    return topology.list_project_placements(db, project)


@router.post("/boards", response_model=BoardRead, status_code=status.HTTP_201_CREATED)
def add_board(
    project_id: int,
    data: BoardCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    return topology.create_board(db, require_project_access(db, project_id, user), data)


@router.put("/boards/{board_id}", response_model=BoardRead)
def replace_board(
    project_id: int,
    board_id: int,
    response: Response,
    data: BoardCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    project = require_project_access(db, project_id, user)
    return topology.update_board(db, project, topology.get_board(db, project, board_id), data)


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_board(
    project_id: int,
    board_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    project = require_project_access(db, project_id, user)
    topology.delete_item(db, topology.get_board(db, project, board_id), project)
    return _empty_mutation_response(response)


@router.get("/boards/{board_id}/circuits", response_model=list[CircuitRead])
def circuits(
    project_id: int,
    board_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    revision = topology.migrate_and_lock_snapshot(db, project)
    response.headers["X-Topology-Revision"] = str(revision)
    return topology.list_circuits(db, topology.get_board(db, project, board_id))


@router.post(
    "/boards/{board_id}/circuits",
    response_model=CircuitRead,
    status_code=status.HTTP_201_CREATED,
)
def add_circuit(
    project_id: int,
    board_id: int,
    data: CircuitCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    project = require_project_access(db, project_id, user)
    return topology.create_circuit(db, topology.get_board(db, project, board_id), data)


@router.put("/circuits/{circuit_id}", response_model=CircuitRead)
def replace_circuit(
    project_id: int,
    circuit_id: int,
    response: Response,
    data: CircuitCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    project = require_project_access(db, project_id, user)
    return topology.update_circuit(db, project, topology.get_circuit(db, project, circuit_id), data)


@router.delete("/circuits/{circuit_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_circuit(
    project_id: int,
    circuit_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    project = require_project_access(db, project_id, user)
    topology.delete_item(db, topology.get_circuit(db, project, circuit_id), project)
    return _empty_mutation_response(response)


@router.get("/circuits/{circuit_id}/loads", response_model=list[LoadRead])
def loads(
    project_id: int,
    circuit_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = require_project_access(db, project_id, user)
    revision = topology.migrate_and_lock_snapshot(db, project)
    response.headers["X-Topology-Revision"] = str(revision)
    return topology.list_loads(db, topology.get_circuit(db, project, circuit_id))


@router.post(
    "/circuits/{circuit_id}/loads",
    response_model=LoadRead,
    status_code=status.HTTP_201_CREATED,
)
def add_load(
    project_id: int,
    circuit_id: int,
    data: LoadCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    project = require_project_access(db, project_id, user)
    return topology.create_load(db, project, topology.get_circuit(db, project, circuit_id), data)


@router.put("/loads/{load_id}", response_model=LoadRead)
def replace_load(
    project_id: int,
    load_id: int,
    response: Response,
    data: LoadCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    project = require_project_access(db, project_id, user)
    return topology.update_load(db, project, topology.get_load(db, project, load_id), data)


@router.delete("/loads/{load_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_load(
    project_id: int,
    load_id: int,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(_check_write_revision),
):
    project = require_project_access(db, project_id, user)
    topology.delete_item(db, topology.get_load(db, project, load_id), project)
    return _empty_mutation_response(response)


def _empty_mutation_response(response: Response) -> Response:
    response.status_code = status.HTTP_204_NO_CONTENT
    return response

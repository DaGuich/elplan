from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class BoardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["main", "sub"] = "sub"
    floor_id: int | None = Field(default=None, gt=0)
    data: dict[str, Any] = Field(default_factory=dict)


class BoardRead(BoardCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int


class CircuitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    data: dict[str, Any] = Field(default_factory=dict)
    source_id: str | None = Field(default=None, max_length=80)


class CircuitRead(CircuitCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    board_id: int


class LoadCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    floor_id: int | None = Field(default=None, gt=0)
    placement_id: str | None = Field(default=None, max_length=80)
    data: dict[str, Any] = Field(default_factory=dict)


class LoadRead(LoadCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    circuit_id: int


class LoadImport(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    floor_ref: tuple[int, int] | None = None
    placement_id: str | None = Field(default=None, max_length=80)
    data: dict[str, Any] = Field(default_factory=dict)


class CircuitImport(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    data: dict[str, Any] = Field(default_factory=dict)
    source_id: str | None = Field(default=None, max_length=80)
    loads: list[LoadImport] = Field(default_factory=list, max_length=500)


class BoardImport(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["main", "sub"] = "sub"
    floor_ref: tuple[int, int] | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    circuits: list[CircuitImport] = Field(default_factory=list, max_length=500)


class TopologyImport(BaseModel):
    boards: list[BoardImport] = Field(default_factory=list, max_length=100)


class TopologyPlacementRead(BaseModel):
    id: str
    floor_id: int
    floor_name: str
    label: str

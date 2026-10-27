from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    organization_id: int
    team_id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    team_id: int | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    organization_id: int
    team_id: int | None = None
    name: str
    description: str | None = None


class FloorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class FloorRead(FloorCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sort_order: int


class BuildingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    floors: list[FloorCreate] = Field(min_length=1, max_length=100)


class BuildingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    name: str
    floors: list[FloorRead]

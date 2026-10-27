from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["owner", "admin", "member"]


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class OrganizationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    role: Role | None = None


class MemberAdd(BaseModel):
    email: str
    role: Role = "member"


class MemberUpdate(BaseModel):
    role: Role


class MemberRead(BaseModel):
    user_id: int
    email: str
    name: str
    role: Role


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class TeamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    organization_id: int
    name: str


class TeamMemberAdd(BaseModel):
    user_id: int

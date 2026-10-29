"""Optional per-room metadata. Free text only: no compliance claims, no derived equipment counts."""

from typing import Annotated

from pydantic import BaseModel, StringConstraints, field_validator

RoomType = Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]
InstallationStandard = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class RoomMetadataMixin(BaseModel):
    room_type: RoomType | None = None
    installation_standard: InstallationStandard | None = None

    @field_validator("room_type", "installation_standard", mode="after")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return value or None

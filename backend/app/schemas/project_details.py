from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProjectStatus = Literal["draft", "planning", "quoted", "in_progress", "completed", "on_hold"]
GridSystem = Literal["TN-S", "TN-C", "TN-C-S", "TT", "IT"]


class PricingTemplate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    unit: str = Field(default="piece", min_length=1, max_length=20)
    unit_price: float = Field(ge=0, le=1_000_000)
    description: str | None = Field(default=None, max_length=300)


class ProjectDetailsData(BaseModel):
    status: ProjectStatus = "planning"
    project_number: str | None = Field(default=None, max_length=100)
    client_name: str | None = Field(default=None, max_length=200)
    client_email: str | None = Field(
        default=None, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    )
    client_phone: str | None = Field(default=None, max_length=50)
    client_address: str | None = Field(default=None, max_length=500)
    site_street: str | None = Field(default=None, max_length=200)
    site_postal_code: str | None = Field(default=None, max_length=20)
    site_city: str | None = Field(default=None, max_length=100)
    site_country: str | None = Field(default=None, max_length=100)
    nominal_voltage_v: int | None = Field(default=None, ge=12, le=1000)
    phases: Literal[1, 3] | None = None
    frequency_hz: Literal[50, 60] | None = None
    grid_system: GridSystem | None = None
    main_fuse_a: float | None = Field(default=None, gt=0, le=10_000)
    short_circuit_ka: float | None = Field(default=None, gt=0, le=200)
    currency: str = Field(default="EUR", pattern=r"^[A-Z]{3}$")
    vat_percent: float | None = Field(default=None, ge=0, le=100)
    hourly_rate: float | None = Field(default=None, ge=0, le=100_000)
    material_markup_percent: float = Field(default=0, ge=0, le=1000)
    pricing_templates: list[PricingTemplate] = Field(default_factory=list, max_length=100)

    @field_validator(
        "project_number",
        "client_name",
        "client_email",
        "client_phone",
        "client_address",
        "site_street",
        "site_postal_code",
        "site_city",
        "site_country",
        mode="before",
    )
    @classmethod
    def blank_to_none(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class ProjectDetailsRead(ProjectDetailsData):
    model_config = ConfigDict(from_attributes=True)

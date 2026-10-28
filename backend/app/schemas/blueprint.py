from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BlueprintCalibration(BaseModel):
    scale_mm_per_pixel: float | None = Field(default=None, gt=0, le=100_000)
    origin_x: float = Field(default=0, ge=-1e9, le=1e9)
    origin_y: float = Field(default=0, ge=-1e9, le=1e9)
    rotation_deg: float = Field(default=0, ge=-360, le=360)
    # left, top, width, height in blueprint pixels
    crop: tuple[float, float, float, float] | None = None
    pdf_page: int = Field(default=1, ge=1, le=10_000)

    @model_validator(mode="after")
    def validate_crop(self):
        if self.crop is not None:
            left, top, width, height = self.crop
            if min(left, top) < 0 or min(width, height) <= 0:
                raise ValueError("crop must be (left>=0, top>=0, width>0, height>0)")
        return self


class BlueprintExport(BlueprintCalibration):
    """Portable blueprint inside project JSON export/import."""

    filename: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1, max_length=35_000_000)


class BlueprintCalibrationUpdate(BaseModel):
    """PATCH semantics: only fields that are sent are changed."""

    scale_mm_per_pixel: float | None = Field(default=None, gt=0, le=100_000)
    origin_x: float | None = Field(default=None, ge=-1e9, le=1e9)
    origin_y: float | None = Field(default=None, ge=-1e9, le=1e9)
    rotation_deg: float | None = Field(default=None, ge=-360, le=360)
    crop: tuple[float, float, float, float] | None = None
    pdf_page: int | None = Field(default=None, ge=1, le=10_000)


class BlueprintRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    floor_id: int
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    version: int
    storage_backend: str
    scale_mm_per_pixel: float | None
    origin_x: float
    origin_y: float
    rotation_deg: float
    crop: tuple[float, float, float, float] | None
    pdf_page: int
    created_at: datetime
    updated_at: datetime

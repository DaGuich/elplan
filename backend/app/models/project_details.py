from sqlalchemy import JSON, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ProjectDetails(Base):
    """Project metadata kept apart from `projects` (one optional row per project)."""

    __tablename__ = "project_details"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="planning")
    project_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    client_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    client_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    client_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    site_street: Mapped[str | None] = mapped_column(String(200), nullable=True)
    site_postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    site_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    site_country: Mapped[str | None] = mapped_column(String(100), nullable=True)
    nominal_voltage_v: Mapped[int | None] = mapped_column(Integer, nullable=True)
    phases: Mapped[int | None] = mapped_column(Integer, nullable=True)
    frequency_hz: Mapped[int | None] = mapped_column(Integer, nullable=True)
    grid_system: Mapped[str | None] = mapped_column(String(10), nullable=True)
    main_fuse_a: Mapped[float | None] = mapped_column(Float, nullable=True)
    short_circuit_ka: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    vat_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    hourly_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    material_markup_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    pricing_templates: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # NULL: visible to every organization member; set: visible to team members only.
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), index=True, nullable=True
    )
    topology_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    buildings: Mapped[list["Building"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Building(Base):
    __tablename__ = "buildings"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    project: Mapped[Project] = relationship(back_populates="buildings")
    floors: Mapped[list["Floor"]] = relationship(
        back_populates="building",
        cascade="all, delete-orphan",
        order_by="Floor.sort_order",
    )


class Floor(Base):
    __tablename__ = "floors"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    building_id: Mapped[int] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(nullable=False)
    plan_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    building: Mapped[Building] = relationship(back_populates="floors")


class ProjectShare(Base):
    __tablename__ = "project_shares"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    client_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)


class BlueprintAsset(Base):
    """Stored blueprint file plus its coordinate metadata (one per floor).

    Replacing the file only changes the file fields; calibration, origin, rotation and
    crop stay untouched, and `floors.plan_data` is never written from here.
    """

    __tablename__ = "blueprint_assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    floor_id: Mapped[int] = mapped_column(
        ForeignKey("floors.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    storage_backend: Mapped[str] = mapped_column(String(20), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scale_mm_per_pixel: Mapped[float | None] = mapped_column(Float, nullable=True)
    origin_x: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    origin_y: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    rotation_deg: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    crop: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # 1-based page shown when the stored file is a multi-page PDF
    pdf_page: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

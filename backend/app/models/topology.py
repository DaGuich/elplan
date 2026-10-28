from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DistributionBoard(Base):
    __tablename__ = "distribution_boards"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    floor_id: Mapped[int | None] = mapped_column(
        ForeignKey("floors.id", ondelete="SET NULL"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class Circuit(Base):
    __tablename__ = "distribution_circuits"

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(
        ForeignKey("distribution_boards.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    source_id: Mapped[str | None] = mapped_column(String(80), nullable=True)


class Load(Base):
    __tablename__ = "distribution_loads"

    id: Mapped[int] = mapped_column(primary_key=True)
    circuit_id: Mapped[int] = mapped_column(
        ForeignKey("distribution_circuits.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    floor_id: Mapped[int | None] = mapped_column(
        ForeignKey("floors.id", ondelete="SET NULL"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    placement_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

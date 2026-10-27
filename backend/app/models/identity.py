from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class UserIdentity(Base):
    """Link between a local user and an external (OAuth2/OIDC) account."""

    __tablename__ = "user_identities"
    __table_args__ = (UniqueConstraint("issuer", "subject"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    issuer: Mapped[str] = mapped_column(String(500), nullable=False)
    subject: Mapped[str] = mapped_column(String(500), nullable=False)

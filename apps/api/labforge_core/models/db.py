"""Database engine + SQLModel models."""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from functools import lru_cache

from sqlalchemy import Column, Text
from sqlmodel import Field, Session, SQLModel, create_engine

from labforge_core.settings import get_settings


class StoredTopology(SQLModel, table=True):
    """A persisted user topology (saved canvas)."""

    __tablename__ = "topologies"

    id: int | None = Field(default=None, primary_key=True)
    slug: str = Field(index=True, unique=True)
    name: str
    description: str = ""
    payload_json: str = Field(sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def payload(self) -> dict:
        return json.loads(self.payload_json)


class Lab(SQLModel, table=True):
    """A provisioned lab instance launched by the agent."""

    __tablename__ = "labs"

    id: int | None = Field(default=None, primary_key=True)
    topology_slug: str = Field(index=True)
    name: str
    provider: str = "virtualbox"
    status: str = "pending"
    workspace_path: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class LabHeartbeat(SQLModel, table=True):
    """Append-only heartbeat row posted by the agent every ~10s while a lab
    is up. The dashboard reads the most-recent row per lab for status and
    the last N rows for the activity feed."""

    __tablename__ = "lab_heartbeats"

    id: int | None = Field(default=None, primary_key=True)
    lab_id: int = Field(index=True)
    captured_at: datetime = Field(default_factory=lambda: datetime.now(UTC), index=True)
    payload_json: str = Field(sa_column=Column(Text, nullable=False))

    def payload(self) -> dict:
        return json.loads(self.payload_json)


@lru_cache(maxsize=1)
def get_engine():
    settings = get_settings()
    is_sqlite = settings.database_url.startswith("sqlite")
    connect_args = {"check_same_thread": False} if is_sqlite else {}
    # The dashboard polls several endpoints (labs list, heartbeat, build/log,
    # node-log x N, wifi-scenario) every few seconds across multiple open
    # tabs. SQLAlchemy's default pool (5 + 10 overflow = 15) is sized for a
    # typical web app's DB-bound requests, not this poll volume — raised here
    # as a safety margin. The real fix for the pool actually running out
    # (QueuePool ... timed out cascading into unrelated endpoints) is that
    # slow subprocess-backed endpoints must not hold a pooled connection open
    # across a 60-90s `vagrant ssh` call; see `_lookup_lab` in
    # api/routers/labs.py. SQLite file connections are cheap, so a larger
    # pool here costs little even when unused.
    pool_kwargs = {"pool_size": 20, "max_overflow": 20} if is_sqlite else {}
    return create_engine(settings.database_url, echo=False, connect_args=connect_args, **pool_kwargs)


def create_db_and_tables() -> None:
    """Create tables. In production, run Alembic migrations instead by
    setting ``LABFORGE_USE_ALEMBIC=1`` and running ``alembic upgrade head``
    out of band — this function then becomes a no-op so create_all doesn't
    fight the migration history.
    """
    import os
    if os.environ.get("LABFORGE_USE_ALEMBIC") == "1":
        return
    SQLModel.metadata.create_all(get_engine())


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session

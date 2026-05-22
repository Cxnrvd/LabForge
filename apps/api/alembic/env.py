"""Alembic environment.

Reads the same ``LABFORGE_DATABASE_URL`` setting as the running API, so
running ``alembic upgrade head`` always targets the right DB regardless
of what ``alembic.ini`` says.
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from alembic import context
from labforge_core.models import db  # noqa: F401 — register SQLModel tables

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Allow runtime override — same env var the FastAPI app uses.
runtime_url = os.environ.get("LABFORGE_DATABASE_URL")
if runtime_url:
    config.set_main_option("sqlalchemy.url", runtime_url)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

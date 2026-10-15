"""initial schema — topologies, labs, lab_heartbeats

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-17

Mirrors the SQLModel tables defined in ``labforge_core.models.db`` at the
point the alembic harness was introduced. From here on, schema changes
get their own migration so production deploys can replay them.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "topologies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "labs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("topology_slug", sa.String(), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False, server_default="virtualbox"),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("workspace_path", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "lab_heartbeats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("lab_id", sa.Integer(), nullable=False, index=True),
        sa.Column("captured_at", sa.DateTime(), nullable=False, index=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("lab_heartbeats")
    op.drop_table("labs")
    op.drop_table("topologies")

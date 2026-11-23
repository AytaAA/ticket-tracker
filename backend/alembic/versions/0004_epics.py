"""Epics (§5). Schema only, no seed data (§9.9).

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-23
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "epics",
        sa.Column("id", sa.BigInteger, primary_key=True),
        # §5.1 exactly one team; §4.5 a team with epics cannot be deleted (no cascade)
        sa.Column("team_id", sa.BigInteger, sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # §5.5 title non-empty after trimming (stored trimmed)
        sa.CheckConstraint("title = btrim(title) AND title <> ''", name="ck_epics_title_trimmed_not_empty"),
        # Target of the tickets' composite FK (epic_id, team_id): "this epic in this team" (§5.7, PLAN.md §1)
        sa.UniqueConstraint("id", "team_id", name="uq_epics_id_team"),
    )
    op.create_index("ix_epics_team_id", "epics", ["team_id"])


def downgrade() -> None:
    op.drop_table("epics")

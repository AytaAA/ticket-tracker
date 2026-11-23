"""Tickets (§6). Schema only, no seed data (§9.9).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-23
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

TYPES = ("bug", "feature", "fix")
STATES = ("new", "ready_for_implementation", "in_progress", "ready_for_acceptance", "done")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "tickets",
        sa.Column("id", sa.BigInteger, primary_key=True),
        # §4.5 a team with tickets cannot be deleted (no cascade)
        sa.Column("team_id", sa.BigInteger, sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("epic_id", sa.BigInteger, nullable=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("state", sa.String(40), nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_by", sa.BigInteger, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # §6.1 exact enum values (PLAN.md D6)
        sa.CheckConstraint(_in("type", TYPES), name="ck_tickets_type"),
        sa.CheckConstraint(_in("state", STATES), name="ck_tickets_state"),
        sa.CheckConstraint("title = btrim(title) AND title <> ''", name="ck_tickets_title_trimmed_not_empty"),
        sa.CheckConstraint("btrim(body) <> ''", name="ck_tickets_body_not_empty"),
        # §5.7 the epic must belong to the ticket's team; §5.8 a referenced epic cannot be deleted
        sa.ForeignKeyConstraint(
            ["epic_id", "team_id"], ["epics.id", "epics.team_id"], name="fk_tickets_epic_same_team", ondelete="RESTRICT"
        ),
    )
    # Board: one team, newest modified first (§8.7)
    op.create_index("ix_tickets_team_modified", "tickets", ["team_id", sa.text("modified_at DESC")])
    op.create_index("ix_tickets_epic_id", "tickets", ["epic_id"])


def downgrade() -> None:
    op.drop_table("tickets")

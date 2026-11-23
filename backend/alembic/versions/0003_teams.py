"""Teams (§4). Schema only, no seed data (§9.9).

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-23
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # §4.4: stored trimmed and never empty; the DB refuses anything else
        sa.CheckConstraint("name = btrim(name) AND name <> ''", name="ck_teams_name_trimmed_not_empty"),
    )
    # §4.4: unique case-insensitively
    op.create_index("uq_teams_name_lower", "teams", [sa.text("lower(name)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_teams_name_lower", table_name="teams")
    op.drop_table("teams")

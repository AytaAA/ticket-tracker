"""Comments (§7). Schema only, no seed data (§9.9).

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-23
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "comments",
        sa.Column("id", sa.BigInteger, primary_key=True),
        # §6.7 deleting a ticket deletes its comments
        sa.Column("ticket_id", sa.BigInteger, sa.ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", sa.BigInteger, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # §7.3 non-empty
        sa.CheckConstraint("btrim(body) <> ''", name="ck_comments_body_not_empty"),
    )
    op.create_index("ix_comments_ticket_created", "comments", ["ticket_id", "created_at"])


def downgrade() -> None:
    op.drop_table("comments")

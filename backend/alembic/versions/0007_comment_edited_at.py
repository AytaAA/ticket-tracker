"""Comments: edited_at, for editing own comments (§14 stretch, requested by the product owner 2026-11-24).
Schema only, no data (§9.9).

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("comments", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("comments", "edited_at")

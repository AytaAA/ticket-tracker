"""Verification tokens: created_at, for the 60-second resend cooldown (security review SEC-1,
product-owner decision 2026-11-24). Schema only, no data (§9.9).

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "email_verification_tokens",
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_column("email_verification_tokens", "created_at")

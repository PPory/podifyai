"""drop speech_onset_ms column from history table

Revision ID: drop_speech_onset_ms
Revises: merge_original_input_branch
Create Date: 2026-04-15 00:00:00.000000

MOSS-TTSD local inference path has been removed. The speech_onset_ms column
was used by onset-detection post-processing that no longer exists.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'drop_speech_onset_ms'
down_revision = 'merge_original_input_branch'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('history') as batch_op:
        batch_op.drop_column('speech_onset_ms')


def downgrade():
    with op.batch_alter_table('history') as batch_op:
        batch_op.add_column(sa.Column('speech_onset_ms', sa.Integer(), nullable=True))

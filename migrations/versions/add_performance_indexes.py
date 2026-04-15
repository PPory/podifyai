"""add performance indexes on history and voice tables

Revision ID: add_performance_indexes
Revises: drop_speech_onset_ms
Create Date: 2026-04-15 00:00:00.000000

Adds indexes that were declared on ORM models but missing in the database:
  - history.user_id  (all history list queries filter by this)
  - history.timestamp  (ORDER BY timestamp DESC)
  - voice.user_id  (voice library queries)
  - voice.is_global  (global voice list queries)
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'add_performance_indexes'
down_revision = 'drop_speech_onset_ms'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('history') as batch_op:
        batch_op.create_index('ix_history_user_id', ['user_id'])
        batch_op.create_index('ix_history_timestamp', ['timestamp'])

    with op.batch_alter_table('voice') as batch_op:
        batch_op.create_index('ix_voice_user_id', ['user_id'])
        batch_op.create_index('ix_voice_is_global', ['is_global'])


def downgrade():
    with op.batch_alter_table('voice') as batch_op:
        batch_op.drop_index('ix_voice_is_global')
        batch_op.drop_index('ix_voice_user_id')

    with op.batch_alter_table('history') as batch_op:
        batch_op.drop_index('ix_history_timestamp')
        batch_op.drop_index('ix_history_user_id')

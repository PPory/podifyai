"""Merge original_input branch into main chain

Revision ID: merge_original_input_branch
Revises: add_history_trace_fields, add_original_input_fields
Create Date: 2026-04-15 00:00:00.000000

This merge revision resolves the two-headed branch that arose because
add_original_input_fields and add_speech_onset_ms both forked from
7b27e4ed97cd. The main chain went through add_speech_onset_ms ->
add_voice_uri_fields -> add_history_trace_fields. This revision
joins the orphaned add_original_input_fields branch back in so that
`flask db upgrade` works on a fresh database.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'merge_original_input_branch'
down_revision = ('add_history_trace_fields', 'add_original_input_fields')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass

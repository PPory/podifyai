"""add voice_id_used and voice_uri_used fields to history table

Revision ID: add_history_trace_fields
Revises: add_voice_uri_fields
Create Date: 2024-12-19 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_history_trace_fields'
down_revision = 'add_voice_uri_fields'
branch_labels = None
depends_on = None


def upgrade():
    """Add voice_id_used and voice_uri_used columns to history table"""
    # Add voice_id_used column (foreign key to voice table)
    op.add_column('history', sa.Column('voice_id_used', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_history_voice_id_used', 'history', 'voice', ['voice_id_used'], ['id'])
    
    # Add voice_uri_used column (string for SiliconFlow voice URI)
    op.add_column('history', sa.Column('voice_uri_used', sa.String(256), nullable=True))


def downgrade():
    """Remove voice_id_used and voice_uri_used columns from history table"""
    op.drop_constraint('fk_history_voice_id_used', 'history', type_='foreignkey')
    op.drop_column('history', 'voice_uri_used')
    op.drop_column('history', 'voice_id_used')

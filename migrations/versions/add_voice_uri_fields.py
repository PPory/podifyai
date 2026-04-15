"""add voice_uri and source_model fields to voice table

Revision ID: add_voice_uri_fields
Revises: add_speech_onset_ms
Create Date: 2024-12-19 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_voice_uri_fields'
down_revision = 'add_speech_onset_ms'
branch_labels = None
depends_on = None


def upgrade():
    """Add voice_uri and source_model columns to voice table"""
    # Add voice_uri column (nullable, for SiliconFlow pre-configured voice URIs)
    op.add_column('voice', sa.Column('voice_uri', sa.String(256), nullable=True))
    
    # Add source_model column (nullable, defaults to fnlp/MOSS-TTSD-v0.5)
    op.add_column('voice', sa.Column('source_model', sa.String(128), nullable=True))


def downgrade():
    """Remove voice_uri and source_model columns from voice table"""
    op.drop_column('voice', 'source_model')
    op.drop_column('voice', 'voice_uri')

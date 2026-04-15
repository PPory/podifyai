"""add_admin_and_premium_fields

Revision ID: 1f87f09d1e41
Revises: 3a11df44bd33
Create Date: 2025-08-23 22:38:22.317946

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1f87f09d1e41'
down_revision = '3a11df44bd33'
branch_labels = None
depends_on = None


def upgrade():
    # 给用户表添加管理员和付费标记
    op.add_column('user', sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('user', sa.Column('has_premium', sa.Boolean(), nullable=False, server_default='0'))
    
    # 给音色表添加全站共享标记
    op.add_column('voice', sa.Column('is_global', sa.Boolean(), nullable=False, server_default='0'))


def downgrade():
    # 删除新添加的字段
    op.drop_column('voice', 'is_global')
    op.drop_column('user', 'has_premium')
    op.drop_column('user', 'is_admin')

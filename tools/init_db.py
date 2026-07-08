#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据库初始化脚本
用于创建数据库表结构和初始数据
"""

import os
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app, db, User, UserAPIKey, Voice, History


def init_database():
    """初始化数据库"""
    with app.app_context():
        try:
            # 创建所有表
            db.create_all()
            print("✅ 数据库表创建成功")

            # 检查是否已存在管理员用户
            admin_user = User.query.filter_by(username='admin').first()
            if not admin_user:
                # 创建默认管理员用户
                admin_user = User(username='admin')
                admin_user.set_password('admin123')  # 默认密码，生产环境中应更改
                db.session.add(admin_user)
                db.session.flush()

                # 创建默认 API 密钥记录，必须在拿到 user_id 后再创建
                admin_api_keys = UserAPIKey(user_id=admin_user.id)
                db.session.add(admin_api_keys)

                db.session.commit()
                print("✅ 默认管理员用户创建成功")
                print("   用户名: admin")
                print("   密码: admin123")
                print("   ⚠️  请在生产环境中更改默认密码！")
            else:
                print("ℹ️  管理员用户已存在")

            print("\n🎉 数据库初始化完成！")
            print("现在可以运行 'python app.py' 启动应用")

        except Exception as e:
            print(f"❌ 数据库初始化失败: {e}")
            sys.exit(1)


if __name__ == '__main__':
    print("🚀 开始初始化数据库...")
    init_database()

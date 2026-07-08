#!/usr/bin/env python3
"""
创建管理员用户和迁移现有音色的脚本
"""

import os
import sys
from pathlib import Path

# 确保能够从项目根目录导入应用入口
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app, db, User, Voice, UserAPIKey
import logging

def create_admin_user(username="admin", email=None, password="admin123456"):
    """创建管理员用户"""
    with app.app_context():
        try:
            # 检查管理员用户是否已存在（按用户名或邮箱）
            admin_user = User.query.filter_by(username=username).first()
            if not admin_user and email:
                admin_user = User.query.filter_by(email=email).first()
            
            if admin_user:
                # 更新现有用户为管理员
                admin_user.is_admin = True
                admin_user.has_premium = True  # 管理员默认也是付费用户
                if email and not admin_user.email:
                    admin_user.email = email
                    admin_user.is_verified = True
                if password:
                    admin_user.set_password(password)
                db.session.commit()
                logging.info(f"已将现有用户 '{admin_user.username}' 设置为管理员")
                return admin_user
            else:
                # 创建新的管理员用户
                admin_user = User(username=username)
                admin_user.set_password(password)
                admin_user.is_admin = True
                admin_user.has_premium = True
                admin_user.is_verified = True
                
                if email:
                    admin_user.email = email
                
                db.session.add(admin_user)
                db.session.commit()
                
                # 为管理员用户创建 API 密钥记录
                admin_api_keys = UserAPIKey(user_id=admin_user.id)
                db.session.add(admin_api_keys)
                db.session.commit()
                
                logging.info(f"成功创建管理员用户: {username}")
                return admin_user
                
        except Exception as e:
            db.session.rollback()
            logging.error(f"创建管理员用户失败: {e}")
            return None

def migrate_voices_to_global(admin_user, voice_names_to_migrate=None):
    """将指定的音色迁移为全站共享"""
    with app.app_context():
        try:
            if voice_names_to_migrate is None:
                # 如果没有指定，可以选择一些优质音色作为全站共享
                # 这里只是示例，实际使用时应该根据具体需求调整
                voice_names_to_migrate = []
            
            migrated_count = 0
            for voice_name in voice_names_to_migrate:
                voice = Voice.query.filter_by(name=voice_name).first()
                if voice and not voice.is_global:
                    voice.is_global = True
                    voice.owner = admin_user  # 将所有权转移给管理员
                    migrated_count += 1
                    logging.info(f"将音色 '{voice_name}' 迁移为全站共享")
            
            if migrated_count > 0:
                db.session.commit()
                logging.info(f"成功迁移 {migrated_count} 个音色为全站共享")
            else:
                logging.info("没有需要迁移的音色")
                
            return migrated_count
            
        except Exception as e:
            db.session.rollback()
            logging.error(f"迁移音色失败: {e}")
            return 0

def setup_premium_users(usernames_to_upgrade=None):
    """设置指定用户为付费用户"""
    with app.app_context():
        try:
            if usernames_to_upgrade is None:
                usernames_to_upgrade = []
            
            upgraded_count = 0
            for username in usernames_to_upgrade:
                user = User.query.filter_by(username=username).first()
                if user and not user.has_premium:
                    user.has_premium = True
                    upgraded_count += 1
                    logging.info(f"将用户 '{username}' 设置为付费用户")
            
            if upgraded_count > 0:
                db.session.commit()
                logging.info(f"成功设置 {upgraded_count} 个用户为付费用户")
            else:
                logging.info("没有需要升级的用户")
                
            return upgraded_count
            
        except Exception as e:
            db.session.rollback()
            logging.error(f"设置付费用户失败: {e}")
            return 0

def main():
    """主函数"""
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    
    print("=== 音色管理系统初始化脚本 ===")
    
    # 1. 创建管理员用户
    admin_username = input("请输入管理员用户名 (默认: admin): ").strip() or "admin"
    admin_email = input("请输入管理员邮箱 (可选): ").strip() or None
    admin_password = input("请输入管理员密码 (默认: admin123456): ").strip() or "admin123456"
    
    admin_user = create_admin_user(admin_username, admin_email, admin_password)
    if not admin_user:
        print("创建管理员用户失败，退出")
        return
    
    print(f"✅ 管理员用户创建成功: {admin_user.username}")
    
    # 2. 询问是否迁移现有音色
    migrate_choice = input("是否要将现有音色迁移为全站共享？(y/N): ").strip().lower()
    if migrate_choice in ['y', 'yes']:
        # 显示现有音色列表
        with app.app_context():
            existing_voices = Voice.query.filter_by(is_global=False).all()
            if existing_voices:
                print("现有的个人音色:")
                for i, voice in enumerate(existing_voices, 1):
                    print(f"  {i}. {voice.name} (类型: {voice.type}, 拥有者: {voice.owner.username})")
                
                voice_indices = input("请输入要迁移的音色序号，用逗号分隔 (例: 1,3,5): ").strip()
                if voice_indices:
                    try:
                        indices = [int(x.strip()) - 1 for x in voice_indices.split(',')]
                        voice_names = [existing_voices[i].name for i in indices if 0 <= i < len(existing_voices)]
                        migrated_count = migrate_voices_to_global(admin_user, voice_names)
                        print(f"✅ 成功迁移 {migrated_count} 个音色为全站共享")
                    except ValueError:
                        print("❌ 输入格式错误")
            else:
                print("没有现有的个人音色可以迁移")
    
    # 3. 询问是否设置付费用户
    premium_choice = input("是否要设置现有用户为付费用户？(y/N): ").strip().lower()
    if premium_choice in ['y', 'yes']:
        # 显示现有用户列表
        with app.app_context():
            existing_users = User.query.filter_by(has_premium=False).all()
            if existing_users:
                print("现有的非付费用户:")
                for i, user in enumerate(existing_users, 1):
                    print(f"  {i}. {user.username}")
                
                user_indices = input("请输入要设置为付费的用户序号，用逗号分隔 (例: 1,3,5): ").strip()
                if user_indices:
                    try:
                        indices = [int(x.strip()) - 1 for x in user_indices.split(',')]
                        usernames = [existing_users[i].username for i in indices if 0 <= i < len(existing_users)]
                        upgraded_count = setup_premium_users(usernames)
                        print(f"✅ 成功设置 {upgraded_count} 个用户为付费用户")
                    except ValueError:
                        print("❌ 输入格式错误")
            else:
                print("没有非付费用户可以升级")
    
    print("\n=== 初始化完成 ===")
    with app.app_context():
        admin_user_info = User.query.filter_by(is_admin=True).first()
        if admin_user_info:
            print(f"管理员用户: {admin_user_info.username}")
            print(f"管理员邮箱: {admin_user_info.email or '未设置'}")
        else:
            print("管理员用户: 已创建")
    print("现在你可以:")
    print("1. 使用管理员账户登录系统")
    print("2. 在前端界面添加全站共享音色")
    print("3. 管理用户的付费状态")

if __name__ == "__main__":
    main()

# 数据库设置说明

## 概述

本项目已从基于JSON文件的存储系统重构为使用SQLite数据库的系统，并集成了用户认证功能。

## 新功能特性

### 1. 数据库模型
- **User**: 用户账户管理
- **UserAPIKey**: 用户专属API密钥存储
- **Voice**: 音色库管理
- **History**: 历史记录管理

### 2. 用户认证系统
- 基于Flask-Login的用户会话管理
- 密码哈希加密存储
- 用户权限控制

## 安装步骤

### 1. 安装依赖
```bash
pip install -r requirements.txt
```

### 2. 初始化数据库
```bash
python tools/init_db.py
```

这将创建：
- `app.db` 数据库文件
- 所有必要的表结构
- 默认管理员账户（用户名：admin，密码：admin123）

### 3. 启动应用
```bash
python app.py
```

## 数据库结构

### User 表
- `id`: 主键
- `username`: 用户名（唯一）
- `password_hash`: 加密后的密码

### UserAPIKey 表
- `id`: 主键
- `user_id`: 关联用户ID
- `gemini_key`: Gemini API密钥
- `gemini_base`: Gemini API基础URL
- `siliconflow_key`: SiliconFlow API密钥
- `siliconflow_base`: SiliconFlow API基础URL

### Voice 表
- `id`: 主键
- `user_id`: 关联用户ID
- `name`: 音色名称
- `text`: 参考文本
- `audio_path`: 音频文件路径
- `type`: 音色类型（'role' 或 'single'）
- `description`: 音色描述

### History 表
- `id`: 主键（UUID格式）
- `user_id`: 关联用户ID
- `title`: 播客标题
- `script_full`: 完整脚本
- `audio_filename`: 音频文件名
- `timestamp`: 创建时间
- `mode`: 生成模式
- `voice_name`: 使用的音色名称
- `duration`: 音频时长
- `play_count`: 播放次数
- `thumbnail_filename`: 缩略图文件名

## 安全注意事项

1. **默认密码**: 生产环境中必须更改默认管理员密码
2. **SECRET_KEY**: 生产环境中应使用强随机字符串
3. **API密钥**: 生产环境中API密钥应加密存储

## 迁移说明

### 从JSON系统迁移
原有的基于JSON文件的系统已被注释掉，将在下一阶段完全替换为数据库操作。

### 数据迁移
如果需要将现有JSON数据迁移到数据库，可以：
1. 如需保留旧数据，备份 `research/legacy-data/voices.json` 和本地 `history.json`
2. 编写迁移脚本将数据导入数据库
3. 验证数据完整性

## 故障排除

### 常见问题

1. **数据库文件权限错误**
   - 确保应用有写入当前目录的权限

2. **表已存在错误**
   - 删除 `app.db` 文件重新初始化

3. **导入错误**
   - 确保所有依赖已正确安装
   - 检查Python路径设置

### 日志查看
应用运行时会输出详细的日志信息，包括：
- 数据库连接状态
- 用户认证过程
- API调用结果

## 下一步开发

1. 实现用户注册和登录API
2. 重构现有API接口以使用数据库
3. 添加用户权限管理
4. 实现数据备份和恢复功能
5. 添加数据库迁移工具

## 联系支持

如遇到问题，请检查：
1. 依赖安装是否完整
2. 数据库文件权限
3. 应用日志输出
4. 系统环境配置

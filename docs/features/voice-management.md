# 音色管理系统使用指南

## 🎯 功能概述

该系统实现了以下功能：

### 👥 用户角色
- **管理员用户**: 可以添加全站共享音色，管理所有音色
- **付费用户**: 可以添加个人音色，使用所有功能
- **普通用户**: 只能使用全站共享音色，添加个人音色需要升级

### 🎵 音色分类
- **全站共享音色**: 由管理员添加，所有用户可使用
- **个人音色**: 用户自己添加，仅自己可使用（需要付费权限）

## 🚀 快速开始

### 1. 初始化系统

```bash
# 运行数据库迁移
python -m flask db upgrade

# 创建管理员用户
python tools/create_admin_user.py
```

### 2. 启动应用

```bash
python app.py
```

### 3. 访问系统

浏览器打开：http://localhost:5000

## 🛠 配置选项

在 `.env.local` 文件中添加以下配置：

```env
# 是否启用付费音色功能
ENABLE_PAID_VOICES=true

# 数据库配置
SECRET_KEY=your-secret-key-here

# API密钥配置
OPENAI_API_KEY=your-gemini-key
SILICONFLOW_API_KEY=your-siliconflow-key
```

## 📋 API接口说明

### 用户状态API

```http
GET /api/user/status
```

返回用户登录状态和权限信息：
```json
{
  "isLoggedIn": true,
  "user": {
    "username": "admin",
    "is_admin": true,
    "has_premium": true
  },
  "enable_paid_voices": true
}
```

### 音色管理API

#### 获取音色列表

```http
GET /voices?type=role|single
```

返回分组音色列表：
```json
{
  "global_voices": [...],
  "personal_voices": [...]
}
```

#### 添加个人音色（需要付费权限）

```http
POST /voices
Content-Type: multipart/form-data

voiceName: 音色名称
referenceText: 参考文本
voiceType: role|single
voiceDescription: 描述
referenceAudio: 音频文件
```

### 管理员API

#### 添加全站共享音色（仅管理员）

```http
POST /admin/voices
Content-Type: multipart/form-data

voiceName: 音色名称
referenceText: 参考文本
voiceType: role|single
voiceDescription: 描述
referenceAudio: 音频文件
```

#### 获取管理员音色列表

```http
GET /admin/voices
```

#### 删除全站共享音色

```http
DELETE /admin/voices/{voice_id}
```

## 🎨 前端功能

### 音色选择界面
- 音色按分组显示：「共享音色（推荐）」和「我的音色」
- 全站共享音色带有「共享」标识
- 普通用户添加音色按钮显示升级提示

### 升级提示模态框
- 非付费用户点击添加音色时显示
- 展示付费功能特性
- 引导用户升级（支付功能待集成）

### 管理员界面
- 管理员可以在音色管理界面添加全站共享音色
- 管理员可以编辑和删除全站共享音色
- 管理员可以查看所有音色统计

## 🧪 测试功能

### 运行测试脚本

```bash
# 测试数据库和用户状态
python test_voice_management.py

# 测试API接口（需要先启动应用）
python test_complete_functionality.py
```

### 手动测试流程

1. **管理员测试**
   - 使用管理员账户登录
   - 测试添加全站共享音色
   - 验证音色在所有用户中可见

2. **付费用户测试**
   - 使用付费用户账户登录
   - 测试添加个人音色
   - 验证音色仅自己可见

3. **普通用户测试**
   - 使用普通用户账户登录
   - 尝试添加音色，应显示升级提示
   - 验证只能使用全站共享音色

## 🔧 数据库结构

### User表新增字段
```sql
is_admin BOOLEAN DEFAULT FALSE    -- 是否为管理员
has_premium BOOLEAN DEFAULT FALSE -- 是否为付费用户
```

### Voice表新增字段
```sql
is_global BOOLEAN DEFAULT FALSE   -- 是否为全站共享音色
```

## 📝 注意事项

1. **权限控制**: 前端和后端都有权限检查，确保安全性
2. **数据迁移**: 现有音色默认为个人音色，可通过脚本迁移为全站共享
3. **付费集成**: 当前为软开关模式，后续可集成Stripe等支付服务
4. **文件管理**: 全站共享音色文件名以`global_`前缀区分

## 🎯 后续扩展

1. **支付集成**: 集成Stripe或其他支付服务
2. **音色审核**: 管理员审核机制
3. **音色分类**: 更细致的音色分类和标签
4. **使用统计**: 音色使用情况统计
5. **批量操作**: 批量导入/导出音色

## 🐛 故障排除

### 常见问题

1. **迁移失败**: 确保数据库连接正常，运行 `python -m flask db upgrade`
2. **权限错误**: 检查用户的 `is_admin` 和 `has_premium` 字段
3. **音色不显示**: 检查音色的 `is_global` 字段设置
4. **API调用失败**: 确保用户已登录且有相应权限

### 日志查看

应用日志会记录所有重要操作：
- 管理员操作
- 音色创建/删除
- 权限检查结果
- API调用错误

## 📞 支持

如有问题，请查看应用日志或联系开发团队。



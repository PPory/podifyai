# ListenHub SendGrid 邮件集成指南

## 概述

ListenHub 现已支持 SendGrid API 作为主要邮件发送服务，同时保留 SMTP 作为备用通道。这种双重保障确保邮件服务的可靠性和稳定性。

## 功能特性

- ✅ **SendGrid API 优先**: 使用 SendGrid 的 REST API 发送邮件
- ✅ **SMTP 回退**: 当 SendGrid 失败时自动回退到 SMTP
- ✅ **沙盒模式**: 支持 SendGrid 沙盒模式进行测试
- ✅ **HTML 邮件**: 支持纯文本和 HTML 格式邮件
- ✅ **配置灵活**: 通过环境变量轻松切换邮件提供商

## 配置说明

### 1. 环境变量配置

在项目根目录创建 `.env.local` 文件（基于 `env_template.txt`）：

```bash
# 选择邮件提供商：sendgrid | smtp
EMAIL_PROVIDER=sendgrid

# SendGrid 配置
SENDGRID_API_KEY=SG.xxxxxxxx
SENDGRID_FROM=u4ptdek@your-verified-domain.com
SENDGRID_FROM_NAME=ListenHub
SENDGRID_SANDBOX=false

# SMTP 备用配置
EMAIL_FROM=noreply@listenhub.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_USE_TLS=true

# 开发模式开关
OTP_DEV_LOG_ONLY=false
```

### 2. SendGrid 设置要求

#### A. API Key 获取
1. 登录 [SendGrid 控制台](https://app.sendgrid.com/)
2. 进入 **Settings** → **API Keys**
3. 创建新的 API Key（建议选择 "Restricted Access" 并只勾选 "Mail Send" 权限）

#### B. 发件人身份验证
**重要**: 必须完成以下任一验证才能发送邮件：

**选项 1: Single Sender Verification**
- 进入 **Settings** → **Sender Authentication**
- 点击 **Single Sender Verification**
- 添加并验证你的邮箱地址

**选项 2: Domain Authentication（推荐）**
- 进入 **Settings** → **Sender Authentication**
- 点击 **Domain Authentication**
- 按照向导配置 DNS 记录（SPF、DKIM、CNAME）
- 验证完成后，该域名下的任意邮箱都可以发送邮件

### 3. 配置优先级

```
.env.local (最高优先级) → 系统环境变量 → 默认值
```

## 使用方法

### 1. 基本邮件发送

```python
from app import send_email_via_sendgrid

# 发送纯文本邮件
success = send_email_via_sendgrid(
    to_email="user@example.com",
    subject="测试邮件",
    text="这是一封测试邮件"
)

# 发送 HTML 邮件
success = send_email_via_sendgrid(
    to_email="user@example.com",
    subject="测试邮件",
    text="纯文本版本",
    html="<p>HTML <strong>版本</strong></p>"
)
```

### 2. OTP 验证码邮件

```python
from app import send_otp_email

# 发送登录验证码
success = send_otp_email("user@example.com", "123456", "login")

# 发送注册验证码
success = send_otp_email("user@example.com", "123456", "register")

# 发送邮箱绑定验证码
success = send_otp_email("user@example.com", "123456", "bind")
```

## 工作流程

### 邮件发送流程

```
1. 检查 EMAIL_PROVIDER 设置
   ↓
2. 如果 EMAIL_PROVIDER=sendgrid:
   - 调用 send_email_via_sendgrid()
   - 如果成功 → 返回 True
   - 如果失败 → 记录警告日志，继续下一步
   ↓
3. 回退到 SMTP:
   - 调用原有的 SMTP 发送逻辑
   - 如果成功 → 返回 True
   - 如果失败 → 记录错误日志，返回 False
```

### 错误处理

- **SendGrid 失败**: 自动回退到 SMTP
- **SMTP 失败**: 记录错误并返回 False
- **配置错误**: 记录详细错误信息
- **网络超时**: 15 秒超时设置

## 测试和调试

### 1. 沙盒模式

设置 `SENDGRID_SANDBOX=true` 启用沙盒模式：
- 邮件不会真实投递
- API 返回 200/202 状态码
- 适合开发和测试环境

### 2. 测试脚本

运行测试脚本验证集成：

```bash
python test_sendgrid_integration.py
```

### 3. 日志监控

启动时查看关键配置：

```
EMAIL_PROVIDER=sendgrid
SENDGRID_FROM=u4ptdek@your-verified-domain.com, SANDBOX=false, API_KEY_SET=YES
```

## 常见问题

### Q1: 邮件发送失败，HTTP 400 错误
**原因**: 发件人邮箱未验证
**解决**: 完成 Single Sender 或 Domain Authentication

### Q2: 邮件发送失败，HTTP 401 错误
**原因**: API Key 无效或权限不足
**解决**: 检查 API Key 是否正确，确保有 "Mail Send" 权限

### Q3: 邮件发送失败，HTTP 403 错误
**原因**: 发件人邮箱被 SendGrid 拒绝
**解决**: 联系 SendGrid 支持或更换发件人邮箱

### Q4: 如何切换到 SMTP 模式？
**解决**: 设置 `EMAIL_PROVIDER=smtp` 并配置 SMTP 参数

## 性能优化

### 1. 批量发送
SendGrid 支持批量发送，可显著提高性能：

```python
# 批量发送到多个收件人
payload = {
    "personalizations": [
        {"to": [{"email": "user1@example.com"}]},
        {"to": [{"email": "user2@example.com"}]}
    ],
    "from": {"email": SENDGRID_FROM, "name": SENDGRID_FROM_NAME},
    "subject": "批量邮件",
    "content": [{"type": "text/plain", "value": "邮件内容"}]
}
```

### 2. 异步发送
SendGrid 返回 202 状态码表示邮件已接受，实际投递是异步的。

## 安全考虑

### 1. API Key 安全
- 不要在代码中硬编码 API Key
- 使用环境变量或配置文件
- 定期轮换 API Key

### 2. 权限最小化
- 只授予必要的权限（Mail Send）
- 避免使用 Full Access 权限

### 3. 发件人验证
- 始终验证发件人身份
- 避免使用未验证的邮箱地址

## 监控和维护

### 1. 发送统计
SendGrid 控制台提供详细的发送统计：
- 发送成功率
- 退信率
- 垃圾邮件投诉率

### 2. 日志分析
定期检查应用日志：
- SendGrid 发送状态
- SMTP 回退情况
- 错误率和趋势

### 3. 性能指标
监控关键指标：
- 邮件发送延迟
- API 响应时间
- 回退频率

## 升级说明

### 从旧版本升级

1. **备份配置**: 备份现有的 SMTP 配置
2. **更新代码**: 拉取最新代码
3. **配置 SendGrid**: 按照上述步骤配置 SendGrid
4. **测试验证**: 运行测试脚本验证功能
5. **切换模式**: 设置 `EMAIL_PROVIDER=sendgrid`

### 回滚方案

如果遇到问题，可以快速回滚：
```bash
# 临时回滚到 SMTP
EMAIL_PROVIDER=smtp
```

## 技术支持

### 1. SendGrid 官方文档
- [API 参考](https://docs.sendgrid.com/api-reference/mail-send)
- [身份验证指南](https://docs.sendgrid.com/ui/account-and-settings/how-to-set-up-domain-authentication)
- [最佳实践](https://docs.sendgrid.com/ui/sending-email/best-practices)

### 2. 常见错误码
- 200/202: 成功
- 400: 请求格式错误
- 401: 认证失败
- 403: 权限不足
- 429: 请求频率限制

---

**注意**: 首次使用 SendGrid 时，建议先在沙盒模式下测试，确保配置正确后再切换到生产模式。

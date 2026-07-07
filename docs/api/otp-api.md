# ListenHub OTP 验证码系统 API 指南

## 🚀 系统升级概述

ListenHub 已成功升级为**邮箱/手机号 + 验证码（OTP）**认证体系，支持更安全便捷的用户验证。

### ✨ 新特性
- 📧 **邮箱验证码登录/注册**
- 📱 **手机号验证码登录/注册**  
- 🔐 **6位数字验证码，10分钟有效**
- 🚫 **智能限流防护**
- 👥 **现有用户无缝兼容**

---

## 📋 API 接口文档

### 1. 发送验证码

**POST** `/api/send-otp`

发送OTP验证码到指定邮箱或手机号。

**请求体：**
```json
{
  "target": "user@example.com",  // 邮箱或手机号
  "purpose": "register"          // 'register' | 'login'
}
```

**响应（成功）：**
```json
{
  "message": "验证码已发送"
}
```

**响应（失败）：**
```json
{
  "error": "该邮箱或手机号已被注册"  // 409
}
{
  "error": "发送过于频繁，请稍后再试"  // 429
}
```

---

### 2. 验证OTP码

**POST** `/api/verify-otp`

验证用户输入的OTP验证码。

**请求体：**
```json
{
  "target": "user@example.com",
  "code": "123456",
  "purpose": "register"
}
```

**响应（注册验证）：**
```json
{
  "message": "验证码验证成功",
  "verified": true,
  "target": "user@example.com",
  "channel": "email"
}
```

**响应（登录验证）：**
```json
{
  "message": "登录成功",
  "user": {
    "username": "john_doe",
    "email": "user@example.com",
    "phone": null,
    "is_verified": true
  }
}
```

---

### 3. 完成OTP注册

**POST** `/api/register-with-otp`

使用已验证的邮箱/手机号完成用户注册。

**请求体：**
```json
{
  "username": "john_doe",
  "password": "secure_password",
  "target": "user@example.com",
  "channel": "email"
}
```

**响应（成功）：**
```json
{
  "message": "注册成功",
  "user": {
    "username": "john_doe",
    "email": "user@example.com",
    "phone": null,
    "is_verified": true
  }
}
```

---

### 4. 用户状态查询

**GET** `/api/user/status`

查询当前用户登录状态（已增强）。

**响应：**
```json
{
  "isLoggedIn": true,
  "user": {
    "username": "john_doe",
    "email": "user@example.com",
    "phone": "13800138000",
    "is_verified": true
  }
}
```

---

## 🔐 验证规则

### 邮箱格式
- 符合标准邮箱格式：`user@domain.com`
- 支持常见域名：gmail, outlook, 163, qq等

### 手机号格式
- 支持中国大陆手机号：`1[3-9]\d{9}`
- 示例：13800138000, 15912345678

### 验证码规则
- **长度**：6位数字
- **有效期**：10分钟
- **尝试次数**：最多5次
- **生成算法**：密码学安全随机数

---

## 🚫 限流保护

### 频率限制
- **每个邮箱/手机号**：10分钟内最多 **3次** 验证码请求
- **每个IP地址**：10分钟内最多 **15次** 总请求
- **超限响应**：HTTP 429 + 错误提示

### 安全机制
- 验证码验证成功后自动删除
- 过期验证码定期清理
- 恶意请求自动拦截

---

## 📱 前端集成示例

### 发送验证码
```javascript
async function sendOTP(target, purpose = 'login') {
  const response = await fetch('/api/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, purpose })
  });
  
  const data = await response.json();
  if (response.ok) {
    alert(data.message);  // "验证码已发送"
  } else {
    alert(data.error);    // 显示错误信息
  }
}

// 使用示例
sendOTP('user@example.com', 'register');
sendOTP('13800138000', 'login');
```

### 验证OTP并登录
```javascript
async function verifyAndLogin(target, code) {
  const response = await fetch('/api/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target,
      code,
      purpose: 'login'
    })
  });
  
  const data = await response.json();
  if (response.ok) {
    // 登录成功，跳转到主页
    window.location.href = '/';
  } else {
    alert(data.error);
  }
}
```

### 完整注册流程
```javascript
// 步骤1：发送验证码
await sendOTP('user@example.com', 'register');

// 步骤2：验证OTP
const verifyResponse = await fetch('/api/verify-otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    target: 'user@example.com',
    code: '123456',
    purpose: 'register'
  })
});

if (verifyResponse.ok) {
  // 步骤3：完成注册
  const registerResponse = await fetch('/api/register-with-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'john_doe',
      password: 'secure_password',
      target: 'user@example.com',
      channel: 'email'
    })
  });
  
  if (registerResponse.ok) {
    // 注册成功，自动登录
    window.location.href = '/';
  }
}
```

---

## 🔄 现有用户迁移

### 自动迁移机制
- **现有用户**：自动设置 `is_verified=true`，保持现有功能
- **登录方式**：仍可使用原有的 `username + password`
- **建议操作**：引导用户绑定邮箱或手机号

### 迁移后用户状态
```json
{
  "username": "existing_user",
  "email": null,           // 待绑定
  "phone": null,           // 待绑定  
  "is_verified": true,     // 自动设置为已验证
  "verified_at": "2025-01-22T10:00:00Z"
}
```

---

## 🚀 生产环境部署

### 邮件服务集成
当前为模拟发送，生产环境需要集成真实邮件服务：

```python
# 在 app.py 中修改 send_otp_email 函数
def send_otp_email(email, code, purpose='login'):
    # TODO: 接入 SendGrid, 阿里云邮件推送, 腾讯云邮件等
    # 示例：SendGrid 集成
    import sendgrid
    from sendgrid.helpers.mail import Mail
    
    sg = sendgrid.SendGridAPIClient(api_key=os.environ.get('SENDGRID_API_KEY'))
    mail = Mail(
        from_email='noreply@listenhub.com',
        to_emails=email,
        subject=f'ListenHub 验证码',
        plain_text_content=f'您的验证码是：{code}，10分钟内有效。'
    )
    response = sg.send(mail)
    return response.status_code == 202
```

### 短信服务集成
```python
# 在 app.py 中修改 send_otp_sms 函数  
def send_otp_sms(phone, code, purpose='login'):
    # TODO: 接入阿里云短信、腾讯云短信等
    # 示例：阿里云短信服务
    from alibabacloud_dysmsapi20170525.client import Client
    
    # 具体实现省略...
    return True
```

---

## 🎯 总结

✅ **完成升级**：邮箱/手机号 + OTP 验证体系  
✅ **向后兼容**：现有用户无感知迁移  
✅ **安全增强**：多重限流 + 验证保护  
✅ **即装即用**：完整的 API 和前端集成  

🚀 **ListenHub OTP 系统已就绪，开始体验更安全便捷的用户认证吧！**

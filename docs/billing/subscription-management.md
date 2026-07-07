# 订阅管理功能实现完成

## 功能概述

在保持现有 UI 的情况下，已成功补齐取消订阅与一键升级到专业版能力。

## 新增功能

### 1. 后端接口

#### `/api/billing/portal` - 订阅管理门户
- **方法**: POST
- **功能**: 打开 Stripe Billing Portal，让用户自助取消或变更订阅/管理付款方式
- **要求**: 用户必须已登录且有 Stripe 客户 ID
- **返回**: `{ok: true, url: "portal_url"}` 或 `{ok: false, error: "error_message"}`

#### `/api/billing/upgrade` - 订阅升级
- **方法**: POST
- **功能**: 从 lite 升级到 pro，直接修改现有订阅的 price，按比例结算（proration）
- **要求**: 用户必须已有订阅
- **返回**: `{ok: true}` 或 `{ok: false, error: "error_message"}`

#### `/api/billing/cancel` - 订阅取消
- **方法**: POST
- **功能**: 取消订阅，支持到期取消和立即取消两种模式
- **参数**: `{"immediate": true/false}` (默认 false，即到期取消)
- **返回**: `{ok: true, scheduled: true/false}` 或 `{ok: false, error: "error_message"}`

### 2. Webhook 增强

新增 `customer.subscription.deleted` 事件处理：
- 当订阅被删除时，自动将用户 plan 重置为 'free'
- 清除 stripe_subscription_id 字段

### 3. 前端功能

#### 智能升级逻辑
- 当 lite 用户点击 pro 时，自动调用升级接口而非创建新订阅
- 升级失败时自动降级为原有 checkout 流程

#### UI 状态管理
- 根据当前订阅状态动态渲染按钮文案和状态
- 已订阅套餐显示为"当前方案"并禁用
- 未订阅套餐显示相应升级文案

#### 订阅管理入口
- 在订阅弹窗底部新增"管理订阅"按钮
- 仅对已订阅用户（lite/pro）显示
- 点击后跳转到 Stripe 管理门户

## 使用方法

### 1. 升级订阅
```javascript
// 前端自动处理：lite 用户点击 pro 时自动升级
// 无需手动调用，startCheckout('pro') 会自动判断
```

### 2. 打开订阅管理
```javascript
// 点击"管理订阅"按钮自动调用
// 或手动调用：
openBillingPortal();
```

### 3. 取消订阅
```javascript
// 到期取消（推荐）
fetch('/api/billing/cancel', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ immediate: false })
});

// 立即取消
fetch('/api/billing/cancel', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ immediate: true })
});
```

## 技术实现

### 1. 升级流程
```
用户点击 pro → 检查当前套餐 → lite 则调用 upgrade → 成功则更新 UI
                                    ↓
                              非 lite 则走 checkout
```

### 2. UI 状态同步
- `refreshCreditsEverywhere()` 函数增强，同时更新订阅 UI 状态
- `renderPlanUI(plan)` 函数根据套餐状态控制按钮显示

### 3. 错误处理
- 升级失败时自动降级为 checkout 流程
- 所有接口都有完整的错误处理和用户提示

## 配置要求

### Stripe 设置
1. **Billing Portal**: 需要在 Stripe 后台开通并配置
2. **产品权限**: 确保 Portal 允许管理相关产品
3. **返回地址**: 配置 `STRIPE_SUCCESS_URL` 环境变量

### 环境变量
```bash
STRIPE_SECRET_KEY=sk_...
STRIPE_PRICE_LITE=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_SUCCESS_URL=https://yourdomain.com/
```

## 测试

使用 `test_subscription_management.html` 文件测试所有新功能：

1. **用户状态获取**: 验证 `/api/user/status` 返回正确的订阅信息
2. **升级测试**: 测试 lite → pro 的升级流程
3. **管理门户**: 测试 Stripe Portal 的创建和跳转
4. **取消测试**: 测试到期取消和立即取消
5. **UI 渲染**: 验证不同套餐状态下的按钮显示

## 注意事项

1. **升级限制**: 只有 lite 用户才能升级到 pro，其他情况走 checkout
2. **取消策略**: 默认到期取消，立即取消需要用户确认
3. **状态同步**: UI 状态通过 `refreshCreditsEverywhere()` 自动同步
4. **错误兜底**: 升级失败时自动回退到原有流程

## 兼容性

- ✅ 保持现有 UI 不变
- ✅ 复用现有的 `.plan-cta` 事件绑定
- ✅ 兼容现有的 `startCheckout` 调用方式
- ✅ 不影响现有的积分包购买流程

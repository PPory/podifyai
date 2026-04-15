# Stripe 支付系统集成完整指南

## 一、环境变量配置

### 1.1 创建 .env.local 文件

将以下内容添加到 `.env.local` 文件中（或部署环境变量）：

```bash
# Stripe 基础
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_SUCCESS_URL=https://你的域名/payment-success?paid=1
STRIPE_CANCEL_URL=https://你的域名/#billing

# 订阅价（月付）
STRIPE_PRICE_LITE=price_xxx_lite_monthly      # $9 / mo，创作者（1000 积分/月）
STRIPE_PRICE_PRO=price_xxx_pro_monthly        # $19 / mo，专业版（3000 积分/月）

# 一次性积分包（可先设：1000=$9、3000=$19）
STRIPE_PRICE_PACK_1000=price_xxx_pack1000
STRIPE_PRICE_PACK_3000=price_xxx_pack3000
```

### 1.2 获取 Stripe 配置值

1. **API 密钥**：在 Stripe Dashboard → Developers → API Keys 获取
2. **Price ID**：在 Stripe Dashboard → Products 创建产品后获取
3. **Webhook Secret**：在 Developers → Webhooks 创建后获取

## 二、Stripe Dashboard 配置

### 2.1 创建产品

在 Stripe Dashboard → Products 中创建以下产品：

#### 订阅产品
- **创作者版**：$9/月，1000 积分/月
- **专业版**：$19/月，3000 积分/月

#### 一次性产品
- **1000 积分包**：$9
- **3000 积分包**：$19

### 2.2 配置 Webhook

1. 进入 **Developers → Webhooks**
2. 点击 **Add endpoint**
3. 端点 URL：`https://你的域名/api/billing/webhook`
4. 选择事件：
   - `checkout.session.completed`
   - `invoice.paid`
5. 复制 **Signing secret** 到 `STRIPE_WEBHOOK_SECRET`

## 三、代码集成完成

### 3.1 后端接口

✅ **已完成**：
- `/api/billing/checkout` - 创建 Stripe Checkout 会话
- `/api/billing/webhook` - 处理支付成功和续费
- 自动数据库字段创建（plan, credits, stripe_customer_id, stripe_subscription_id）
- 积分自动发放逻辑

### 3.2 前端集成

✅ **已完成**：
- 订阅按钮：调用 `startCheckout('lite')` 或 `startCheckout('pro')`
- 积分包按钮：调用 `startCheckout('pack1000')` 或 `startCheckout('pack3000')`
- 支付成功后自动刷新积分显示

## 四、测试流程

### 4.1 本地测试

1. **安装 Stripe CLI**：
   ```bash
   # Windows (使用 Chocolatey)
   choco install stripe-cli
   
   # 或下载安装包：https://github.com/stripe/stripe-cli/releases
   ```

2. **监听 Webhook**：
   ```bash
   stripe listen --forward-to localhost:5000/api/billing/webhook
   ```

3. **使用测试密钥**：
   - 将 `STRIPE_SECRET_KEY` 改为 `sk_test_...`
   - 使用测试模式的 Price ID

### 4.2 测试步骤

1. 启动应用
2. 登录用户账户
3. 点击订阅或积分包按钮
4. 完成 Stripe 测试支付
5. 验证积分是否正确增加

## 五、生产部署

### 5.1 环境变量

- 使用生产环境的 Stripe 密钥（`sk_live_...`）
- 更新域名配置
- 确保 Webhook 端点可访问

### 5.2 安全配置

- 启用 HTTPS
- 配置防火墙规则
- 监控 Webhook 调用日志

## 六、功能特性

### 6.1 订阅管理

- **自动续费**：每月自动发放积分
- **计划升级/降级**：支持切换订阅计划
- **客户管理**：自动创建 Stripe 客户记录

### 6.2 积分系统

- **实时更新**：支付成功后立即更新积分
- **历史记录**：记录积分来源和用途
- **余额显示**：侧边栏和弹窗实时显示

### 6.3 容错机制

- **数据库兼容**：自动创建缺失字段
- **Webhook 验证**：签名验证防止伪造
- **错误处理**：详细的日志记录和错误恢复

## 七、监控和维护

### 7.1 日志监控

- 支付成功/失败日志
- Webhook 调用状态
- 积分发放记录

### 7.2 常见问题

1. **Webhook 失败**：检查签名密钥和端点可访问性
2. **积分未到账**：查看 Webhook 日志和数据库状态
3. **订阅异常**：检查 Stripe Dashboard 中的订阅状态

## 八、升级建议

### 8.1 功能扩展

- 添加支付失败重试机制
- 实现订阅取消和退款
- 支持多种货币和地区

### 8.2 性能优化

- 异步处理 Webhook 事件
- 缓存用户积分信息
- 批量积分操作

---

**注意**：首次部署时，系统会自动为现有用户表添加必要的字段。确保在生产环境部署前进行充分测试。


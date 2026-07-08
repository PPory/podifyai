import stripe
from flask import Blueprint, current_app

from .extensions import db
from .models import CreditTxn, StripeEventLog, User
from .services import *

bp = Blueprint('billing', __name__)

PLAN_CREDITS = {
    "lite": 1000,   # 创作者
    "pro": 3000,    # 专业版
}
PRICE_MAP = {
    "lite": os.getenv("STRIPE_PRICE_LITE"),
    "pro": os.getenv("STRIPE_PRICE_PRO"),
    "pack1000": os.getenv("STRIPE_PRICE_PACK_1000"),
    "pack3000": os.getenv("STRIPE_PRICE_PACK_3000"),
}
SUCCESS_URL = os.getenv("STRIPE_SUCCESS_URL", "http://localhost:5000/payment-success?paid=1")
CANCEL_URL  = os.getenv("STRIPE_CANCEL_URL",  "http://localhost:5000/#billing")

def _ensure_user_columns():
    # 容错：首次运行若缺字段，自动加列
    try:
        with current_app.app_context():
            insp = db.inspect(db.engine)
            cols = {c["name"] for c in insp.get_columns("user")}  # 你的用户表名若非 user，请改
            alter_sql = []
            if "plan" not in cols:
                alter_sql.append("ALTER TABLE user ADD COLUMN plan VARCHAR(20) DEFAULT 'free'")
            if "credits" not in cols:
                alter_sql.append("ALTER TABLE user ADD COLUMN credits INTEGER DEFAULT 30")
            if "stripe_customer_id" not in cols:
                alter_sql.append("ALTER TABLE user ADD COLUMN stripe_customer_id VARCHAR(64)")
            if "stripe_subscription_id" not in cols:
                alter_sql.append("ALTER TABLE user ADD COLUMN stripe_subscription_id VARCHAR(64)")
            if "avatar_path" not in cols:
                alter_sql.append("ALTER TABLE user ADD COLUMN avatar_path VARCHAR(255)")
            for sql in alter_sql:
                db.session.execute(db.text(sql))
            if alter_sql:
                db.session.commit()
                current_app.logger.info(f"成功添加数据库字段: {alter_sql}")
    except Exception as e:
        current_app.logger.warning(f"添加数据库字段失败: {e}")

# 在应用启动时调用，而不是模块级别
# _ensure_user_columns()

def _validate_stripe_config():
    """验证 Stripe 配置是否完整"""
    missing_vars = []
    
    # 检查必需的环境变量
    required_vars = [
        'STRIPE_SECRET_KEY',
        'STRIPE_PRICE_LITE',
        'STRIPE_PRICE_PRO', 
        'STRIPE_PRICE_PACK_1000',
        'STRIPE_PRICE_PACK_3000'
    ]
    
    for var in required_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        current_app.logger.error(f"❌ Stripe 配置缺失: {missing_vars}")
        current_app.logger.error("请在 .env.local 中设置这些环境变量")
        return False
    
    # 验证价格 ID 格式
    for plan, price_id in PRICE_MAP.items():
        if not price_id or not price_id.startswith('price_'):
            current_app.logger.error(f"❌ 无效的价格 ID: {plan}={price_id}")
            return False
    
    current_app.logger.info("✅ Stripe 配置验证通过")
    return True

def _add_credits(user, amount, reason=""):
    if amount and amount > 0:
        user.credits = (user.credits or 0) + int(amount)
        db.session.add(CreditTxn(user_id=user.id, delta=int(amount), reason=(reason or 'admin')[:32], ref=None))
        db.session.commit()
        current_app.logger.info(f"[credits] +{amount} to user {user.id} ({reason}) => {user.credits}")

@bp.route('/api/billing/checkout', methods=['POST'])
@login_required
def billing_checkout():
    """
    创建 Stripe Checkout 会话
    前端传参：{"plan": "lite"|"pro"|"pack1000"|"pack3000"}
    - lite/pro => 订阅
    - pack1000/pack3000 => 一次性付款
    """
    try:
        data = request.get_json() or {}
        plan = data.get('plan')
        
        # 调试信息
        current_app.logger.info(f"收到支付请求: plan={plan}, 用户={current_user.id}")
        current_app.logger.info(f"当前 PRICE_MAP: {PRICE_MAP}")
        
        price_id = PRICE_MAP.get(plan)
        if not price_id:
            current_app.logger.error(f"未找到价格配置: plan={plan}")
            return jsonify({'ok': False, 'error': f'无效的产品/价格: {plan}'}), 400

        current_app.logger.info(f"使用价格 ID: {price_id}")
        mode = 'subscription' if plan in ('lite', 'pro') else 'payment'

        # 1) 预校验 Price 类型，避免把 one_time 用到订阅
        price = stripe.Price.retrieve(price_id)
        if mode == 'subscription' and not price.get('recurring'):
            return jsonify({'ok': False, 'error': f'配置错误：{plan} 需使用 recurring 价格，请检查 STRIPE_PRICE_LITE/PRO'}), 400
        if mode == 'payment' and price.get('type') != 'one_time':
            return jsonify({'ok': False, 'error': f'配置错误：{plan} 需使用 one_time 价格，请检查 STRIPE_PRICE_PACK_*'}), 400

        # 2) 构建 success_url（Stripe 会自动替换 {CHECKOUT_SESSION_ID}）
        base_url = os.environ.get('STRIPE_SUCCESS_URL', 'http://127.0.0.1:5000/')
        
        # 确保 URL 格式正确
        if '?' in base_url:
            # 如果已经有查询参数，添加新的参数
            success_url = f"{base_url}&paid=1&session_id={{CHECKOUT_SESSION_ID}}"
        else:
            # 如果没有查询参数，添加第一个查询参数
            success_url = f"{base_url}?paid=1&session_id={{CHECKOUT_SESSION_ID}}"
        
        current_app.logger.info(f"构建的 success_url: {success_url}")

        # 3) 仅当存在邮箱时才附上 customer_email
        kwargs = dict(
            mode=mode,
            line_items=[{'price': price_id, 'quantity': 1}],
            success_url=success_url,
            cancel_url=CANCEL_URL,
            client_reference_id=str(current_user.id),
            allow_promotion_codes=True,
        )
        if current_user.email:
            kwargs['customer_email'] = current_user.email

        session = stripe.checkout.Session.create(**kwargs)
        return jsonify({'ok': True, 'url': session.url})

    except stripe.error.StripeError as e:
        # 把 Stripe 的报错（开发期非常有用）回给前端
        current_app.logger.exception("Stripe API 错误")
        msg = getattr(e, 'user_message', None) or str(e)
        return jsonify({'ok': False, 'error': f'创建支付会话失败：{msg}'}), 400
    except Exception as e:
        current_app.logger.exception("创建支付会话失败")
        return jsonify({'ok': False, 'error': f'创建支付会话失败：{str(e)}'}), 500


# === Manage Subscription (Billing Portal / Upgrade / Cancel) ===


@bp.route('/api/billing/upgrade', methods=['POST'])
@login_required
def billing_upgrade():
    """
    从 lite 升级到 pro：直接修改现有订阅的 price，按比例结算（proration）
    若用户尚无订阅，返回 no_subscription（前端可回退到普通 checkout）
    """
    sub_id = getattr(current_user, 'stripe_subscription_id', None)
    if not sub_id:
        return jsonify({'ok': False, 'error': 'no_subscription'}), 400
    try:
        sub = stripe.Subscription.retrieve(sub_id)
        item_id = sub['items']['data'][0]['id']
        new_price = PRICE_MAP.get('pro')
        if not new_price:
            return jsonify({'ok': False, 'error': 'missing_pro_price'}), 400

        stripe.Subscription.modify(
            sub_id,
            items=[{'id': item_id, 'price': new_price}],
            cancel_at_period_end=False,
            proration_behavior='create_prorations'
        )
        # 本地立即切换 plan，实际扣费按 Stripe 规则结算
        current_user.plan = 'pro'
        db.session.commit()
        return jsonify({'ok': True})
    except Exception as e:
        current_app.logger.exception("upgrade failed")
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/api/billing/cancel', methods=['POST'])
@login_required
def billing_cancel():
    """
    取消订阅：默认"到期取消"(cancel_at_period_end=True)；传 immediate=True 可立即取消
    实际生效后再由 webhook 把 plan 置回 free
    """
    data = request.get_json() or {}
    immediate = bool(data.get('immediate', False))
    sub_id = getattr(current_user, 'stripe_subscription_id', None)
    if not sub_id:
        return jsonify({'ok': False, 'error': 'no_subscription'}), 400
    try:
        if immediate:
            stripe.Subscription.delete(sub_id, prorate=True)
        else:
            stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
        return jsonify({'ok': True, 'scheduled': not immediate})
    except Exception as e:
        current_app.logger.exception("cancel failed")
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/api/billing/webhook', methods=['POST'])
def stripe_webhook():
    """
    处理入账：
    - checkout.session.completed (subscription/payment)
    - invoice.paid (订阅续费)
    """
    payload = request.data
    sig = request.headers.get('Stripe-Signature', '')
    wh_secret = os.getenv('STRIPE_WEBHOOK_SECRET')
    try:
        event = stripe.Webhook.construct_event(payload, sig, wh_secret)
    except Exception as e:
        current_app.logger.warning(f"Webhook 验签失败: {e}")
        return ("", 400)

    etype = event['type']
    obj = event['data']['object']

    def _get_user_by_client_ref(obj):
        uid = obj.get("client_reference_id")
        if not uid:  # 续费的 invoice 没这个字段
            return None
        try:
            return db.session.get(User, int(uid))
        except Exception:
            return None

    # 1) 首次结账成功
    if etype == 'checkout.session.completed':
        sess = obj
        mode = sess.get('mode')  # subscription | payment
        uid = sess.get('client_reference_id')
        user = db.session.get(User, int(uid)) if uid else None
        if not user:
            return ("", 200)

        # 订阅：写入 plan、绑定 customer/subscription，并发放当月积分
        if mode == 'subscription':
            sub_id = sess.get('subscription')
            customer_id = sess.get('customer')
            # 取 price_id 判断是 lite 还是 pro
            try:
                sub = stripe.Subscription.retrieve(sub_id)
                price_id = sub['items']['data'][0]['price']['id']
            except Exception:
                price_id = None

            # 反查属于哪个 plan
            plan = None
            for k, pid in PRICE_MAP.items():
                if k in ('lite', 'pro') and pid == price_id:
                    plan = k
                    break

            if plan in ('lite', 'pro'):
                user.plan = plan
                user.stripe_customer_id = customer_id
                user.stripe_subscription_id = sub_id
                db.session.commit()
                # 发放当月积分
                _add_credits(user, PLAN_CREDITS[plan], f"subscribe:{plan}")
        else:
            # 一次性：根据 line item 的 price 入账积分
            try:
                line_items = stripe.checkout.Session.list_line_items(sess['id'], limit=1)
                price_id = line_items['data'][0]['price']['id']
            except Exception:
                price_id = None

            if price_id == PRICE_MAP['pack1000']:
                _add_credits(user, 1000, "pack1000")
            elif price_id == PRICE_MAP['pack3000']:
                _add_credits(user, 3000, "pack3000")

        return ("", 200)

    # 2) 订阅续费成功：再发放当月积分
    if etype == 'invoice.paid':
        invoice = obj
        sub_id = invoice.get('subscription')
        customer_id = invoice.get('customer')
        if not sub_id:
            return ("", 200)

        user = User.query.filter_by(stripe_subscription_id=sub_id).first()
        if not user:
            # 兜底：也可按 customer 找
            user = User.query.filter_by(stripe_customer_id=customer_id).first()
        if not user:
            return ("", 200)

        # 识别该订阅属于哪个 plan（取第一条价）
        try:
            sub = stripe.Subscription.retrieve(sub_id)
            price_id = sub['items']['data'][0]['price']['id']
        except Exception:
            price_id = None

        if price_id == PRICE_MAP['lite']:
            _add_credits(user, PLAN_CREDITS['lite'], "renew:lite")
            user.plan = 'lite'
            db.session.commit()
        elif price_id == PRICE_MAP['pro']:
            _add_credits(user, PLAN_CREDITS['pro'], "renew:pro")
            user.plan = 'pro'
            db.session.commit()

        return ("", 200)

    # 3) 订阅被取消（到期生效后 Stripe 会发 deleted）
    if etype == 'customer.subscription.deleted':
        sub_id = obj.get('id')
        user = User.query.filter_by(stripe_subscription_id=sub_id).first()
        if user:
            user.plan = 'free'
            user.stripe_subscription_id = None
            db.session.commit()
        return ("", 200)

    return ("", 200)


# --------------------------------------------
# 兜底验证接口：支付成功后前端拿 session_id 调这个接口；已付则入账并返回最新状态
@bp.route('/api/billing/verify', methods=['POST'])
@login_required
def billing_verify():
    data = request.get_json() or {}
    session_id = data.get('session_id')
    if not session_id:
        return jsonify({'ok': False, 'msg': 'missing session_id'}), 400

    try:
        # 拉取会话，展开 line_items 以拿到 price_id
        session = stripe.checkout.Session.retrieve(
            session_id,
            expand=['line_items.data.price.product', 'subscription', 'line_items', 'customer']
        )

        # --- 新增：把 Stripe Customer 回写到用户表，便于后续打开 Billing Portal ---
        cust = None
        try:
            # session.customer 可能是字符串或对象，做两手处理
            cust = session.get('customer')
            if hasattr(cust, 'id'):
                cust = cust.id
        except Exception:
            cust = session.get('customer')

        if cust and (not current_user.stripe_customer_id or current_user.stripe_customer_id != cust):
            current_user.stripe_customer_id = cust
            db.session.commit()
        # --- 新增结束 ---

        # 未付款就直接返回
        if session.get('payment_status') != 'paid':
            return jsonify({'ok': True, 'paid': False})

        # 幂等：同一个 session_id 不重复入账
        if StripeEventLog.query.filter_by(event_id=session_id).first():
            # 已处理过，直接回传当前用户状态
            return jsonify({
                'ok': True,
                'paid': True,
                'status': _user_status_payload()   # 见下辅助函数
            })

        # 价格 ID → 套餐与积分的映射
        price_id = session['line_items']['data'][0]['price']['id']
        lite_id = os.environ.get('STRIPE_PRICE_LITE')            # $9 / 1000
        pro_id  = os.environ.get('STRIPE_PRICE_PRO')             # $19 / 3000
        pack1k  = os.environ.get('STRIPE_PRICE_PACK_1000')       # 1000 积分一次性
        pack3k  = os.environ.get('STRIPE_PRICE_PACK_3000')       # 3000 积分一次性

        give_points = 0
        plan = None
        if price_id == lite_id:
            plan = 'lite'         # 统一命名
            give_points = 1000
        elif price_id == pro_id:
            plan = 'pro'         # 专业版
            give_points = 3000
        elif price_id == pack1k:
            give_points = 1000
        elif price_id == pack3k:
            give_points = 3000

        # 更新用户
        if give_points:
            current_user.credits = (current_user.credits or 0) + give_points
        if plan:
            current_user.plan = plan   # 使用现有的 plan 字段
        db.session.add(StripeEventLog(event_id=session_id, user_id=current_user.id))
        db.session.commit()

        return jsonify({'ok': True, 'paid': True, 'status': _user_status_payload()})
    except stripe.error.StripeError as e:
        current_app.logger.exception(f"Stripe API 错误: {e}")
        return jsonify({'ok': False, 'msg': f'Stripe 错误: {str(e)}'}), 400
    except Exception as e:
        current_app.logger.exception("verify failed")
        return jsonify({'ok': False, 'msg': f'服务器错误: {str(e)}'}), 500

@bp.route('/api/billing/portal', methods=['POST'])
@login_required
def billing_portal():
    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not stripe_secret_key:
        return "stripe_not_configured", 400

    stripe.api_key = stripe_secret_key

    try:
        data = request.get_json(silent=True) or {}
        # 优先使用调用方传来的返回地址，否则用环境变量中的成功回跳或默认到设置页
        return_url = (
            data.get('return_url')
            or os.environ.get('STRIPE_SUCCESS_URL')
            or (request.host_url.rstrip('/') + '/#billing')
        )

        # 1) 先用数据库里的 customer_id
        customer_id = current_user.stripe_customer_id

        # 2) 若没有，尝试通过邮箱在 Stripe 侧查询
        if not customer_id and current_user.email:
            res = stripe.Customer.list(email=current_user.email, limit=1)
            if res and res.data:
                customer_id = res.data[0].id

        # 3) 再不行，尝试通过最近一次我们记录的 Checkout Session 反查
        if not customer_id:
            last_log = StripeEventLog.query.filter_by(user_id=current_user.id) \
                .order_by(StripeEventLog.created_at.desc()).first()
            if last_log:
                try:
                    sess = stripe.checkout.Session.retrieve(last_log.event_id, expand=['customer'])
                    if sess and getattr(sess, 'customer', None):
                        customer_id = sess.customer.id if hasattr(sess.customer, 'id') else sess.customer
                except Exception:
                    pass

        # 4) 仍然没有：为该用户创建一个 Stripe Customer（允许用户先进 Portal 绑定付款方式）
        if not customer_id:
            created = stripe.Customer.create(
                email=current_user.email or None,
                name=current_user.username or None,
                metadata={'app_user_id': current_user.id}
            )
            customer_id = created.id

        # 落库，后续就不需要再兜底了
        if current_user.stripe_customer_id != customer_id:
            current_user.stripe_customer_id = customer_id
            db.session.commit()

        # 5) 创建 Billing Portal 会话
        portal = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url
        )
        return jsonify({'url': portal.url})

    except Exception as e:
        current_app.logger.error(f"Create billing portal failed: {e}", exc_info=True)
        # 保留可读的错误信息，便于你在前端 alert
        return str(e), 400




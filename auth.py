from flask import Blueprint, current_app

from extensions import db
from models import OTPCode, User, UserAPIKey
from services import *

bp = Blueprint('auth', __name__)

@bp.route('/register', methods=['POST'])
def register():
    """用户注册接口（兼容旧版用户名+密码方式）"""
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': '用户名和密码不能为空'}), 400

    username = data['username']
    password = data['password']
    email = data.get('email')  # 可选的邮箱
    phone = data.get('phone')  # 可选的手机号

    # 如果启用了强制联系方式验证，要求必须提供邮箱或手机号
    if REQUIRE_CONTACT_VERIFICATION and not (email or phone):
        return jsonify({'error': '注册需要验证邮箱或手机号，请使用验证码注册'}), 400

    # 获取客户端IP
    client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)

    if User.query.filter_by(username=username).first():
        log_auth_event('register', username, client_ip, None, False, 'Username exists')
        return jsonify({'error': '用户名已存在'}), 409

    # 检查邮箱和手机号是否已被使用
    if email:
        email = normalize_target(email, 'email')
        if not validate_email(email):
            return jsonify({'error': '邮箱格式不正确'}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({'error': '该邮箱已被注册'}), 409
    
    if phone:
        phone = normalize_target(phone, 'phone')
        if not validate_phone(phone):
            return jsonify({'error': '手机号格式不正确'}), 400
        if User.query.filter_by(phone=phone).first():
            return jsonify({'error': '该手机号已被注册'}), 409

    new_user = User(username=username)
    new_user.set_password(password)
    
    # 如果提供了邮箱或手机号，进行赋值但不强制验证（过渡期）
    if email:
        new_user.email = email
    if phone:
        new_user.phone = phone
    
    # 过渡期：允许旧方式注册，但提示需要验证
    has_contact = bool(email or phone)
    if has_contact:
        # 有联系方式，设置为未验证状态
        new_user.is_verified = False
    else:
        # 无联系方式，暂时设置为已验证（兼容性）
        new_user.is_verified = True
        new_user.verified_at = datetime.datetime.utcnow()
    
    db.session.add(new_user)
    db.session.commit()
    
    # 注册成功后自动为用户创建一个空的APIKey记录
    new_api_key_record = UserAPIKey(user_id=new_user.id)
    db.session.add(new_api_key_record)
    db.session.commit()

    log_auth_event('register', email or phone or username, client_ip, new_user.id, True, 'Legacy registration')
    
    response = {'message': '注册成功'}
    
    # 如果有联系方式但未验证，提示需要验证
    if has_contact and not new_user.is_verified:
        response['need_verification'] = True
        response['contact_method'] = 'email' if email else 'phone'
        response['contact_target'] = email or phone
    elif not has_contact:
        response['need_bind_contact'] = True
        response['suggestion'] = '建议绑定邮箱或手机号以提升账户安全性'
    
    return jsonify(response), 201

@bp.route('/login', methods=['POST'])
def login():
    """用户登录接口（兼容旧版用户名+密码方式）"""
    # 检查是否允许传统密码登录
    if not ALLOW_LEGACY_PASSWORD_LOGIN:
        return jsonify({'error': '传统密码登录已禁用，请使用验证码登录'}), 403
    
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': '用户名和密码不能为空'}), 400

    # 获取客户端IP
    client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)

    user = User.query.filter_by(username=data['username']).first()

    if user is None or not user.check_password(data['password']):
        log_auth_event('login', data['username'], client_ip, None, False, 'Invalid credentials')
        return jsonify({'error': '用户名或密码无效'}), 401

    # 如果启用了强制联系方式验证
    if REQUIRE_CONTACT_VERIFICATION and not user.is_verified:
        log_auth_event('login', data['username'], client_ip, user.id, False, 'Unverified account')
        return jsonify({'error': '账户未验证，请使用验证码登录'}), 403

    login_user(user)
    log_auth_event('login', data['username'], client_ip, user.id, True, 'Legacy password login')
    
    response = {'message': '登录成功'}
    
    # 检查用户是否需要绑定联系方式或验证
    if not user.has_contact_method():
        response['need_bind_contact'] = True
        response['suggestion'] = '为了提升账户安全性，建议绑定邮箱或手机号'
    elif not user.is_verified:
        contact, channel = user.get_contact_for_otp()
        response['need_verification'] = True
        response['contact_method'] = channel
        response['contact_target'] = contact
        response['suggestion'] = f'请验证您的{("邮箱" if channel == "email" else "手机号")}以完成账户验证'
    
    return jsonify(response)

@bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """用户登出接口"""
    logging.info(f"用户登出: {current_user.username}")
    logout_user()
    return jsonify({'message': '登出成功'})

@bp.route('/auth/login-password', methods=['POST'])
def login_with_password():
    """邮箱+密码登录接口"""
    if not ALLOW_PASSWORD_LOGIN:
        return jsonify({'ok': False, 'error': '密码登录已关闭'}), 403
    
    try:
        data = request.get_json(force=True)
        email = (data.get('email') or '').strip().lower()
        pw = data.get('password') or ''
        
        if not email or not pw:
            return jsonify({'ok': False, 'error': '邮箱和密码不能为空'}), 400
        
        # 查找用户（使用 func.lower 进行不区分大小写的比较）
        user = User.query.filter(func.lower(User.email) == email).first()
        
        if not user or not user.check_password(pw):
            return jsonify({'ok': False, 'error': '邮箱或密码不正确'}), 401
        
        # 登录用户
        login_user(user)
        return jsonify({'ok': True})
        
    except Exception as e:
        logging.error(f"密码登录失败: {e}", exc_info=True)
        return jsonify({'ok': False, 'error': '登录失败，请稍后重试'}), 500

@bp.route('/account/password/request-code', methods=['POST'])
@login_required
def request_password_code():
    """请求密码相关操作的验证码"""
    try:
        data = request.get_json()
        purpose = data.get('purpose', '').strip()
        
        if purpose not in ['password_set', 'password_change']:
            return jsonify({'ok': False, 'error': '无效的验证码用途'}), 400
        
        if not current_user.email:
            return jsonify({'ok': False, 'error': '用户未绑定邮箱'}), 400
        
        # 获取客户端IP
        client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)
        
        # 清理超限验证码
        disable_excessive_attempts()
        
        # 检查节流限制
        is_allowed, remaining = check_rate_limit(client_ip, current_user.email)
        if not is_allowed:
            return jsonify({'ok': False, 'error': '发送过于频繁，请稍后再试'}), 429
        
        # 生成并保存验证码
        otp_code = create_otp_code(current_user.email, 'email', purpose, client_ip)
        if not otp_code:
            return jsonify({'ok': False, 'error': '验证码生成失败，请稍后重试'}), 500
        
        # 发送验证码
        success = send_otp_email(current_user.email, otp_code.code, purpose)
        
        if success:
            return jsonify({'ok': True})
        else:
            # 发送失败，删除验证码
            db.session.delete(otp_code)
            db.session.commit()
            return jsonify({'ok': False, 'error': '验证码发送失败'}), 500
            
    except Exception as e:
        logging.error(f"请求密码验证码失败: {e}", exc_info=True)
        return jsonify({'ok': False, 'error': '请求验证码失败'}), 500

@bp.route('/account/password/update', methods=['POST'])
@login_required
def update_password():
    """设置或修改密码"""
    try:
        data = request.get_json()
        mode = data.get('mode', '').strip()
        current_password = data.get('current_password', '').strip()
        otp_code = data.get('otp_code', '').strip()
        new_password = data.get('new_password', '').strip()
        new_password_confirm = data.get('new_password_confirm', '').strip()
        
        if mode not in ['set', 'change']:
            return jsonify({'ok': False, 'error': '无效的操作模式'}), 400
        
        if not new_password or not new_password_confirm:
            return jsonify({'ok': False, 'error': '新密码和确认密码不能为空'}), 400
        
        if new_password != new_password_confirm:
            return jsonify({'ok': False, 'error': '密码不符合要求或两次不一致'}), 400
        
        if len(new_password) < 8:
            return jsonify({'ok': False, 'error': '密码不符合要求或两次不一致'}), 400
        
        # 验证身份
        if mode == 'set':
            # 设置密码：检查是否已有密码
            if current_user.password_hash:
                return jsonify({'ok': False, 'error': '用户已设置密码，请使用修改模式'}), 400
            
            # 设置模式：需要验证码或无需验证
            if otp_code:
                # 验证OTP
                otp = OTPCode.query.filter_by(
                    target=current_user.email,
                    channel='email',
                    purpose='password_set',
                    code=otp_code
                ).first()
                
                if not otp or otp.is_expired():
                    return jsonify({'ok': False, 'error': '验证码无效或已过期'}), 400
                
                # 删除已使用的验证码
                db.session.delete(otp)
        
        elif mode == 'change':
            # 修改密码：必须验证旧密码或验证码
            if not current_password and not otp_code:
                return jsonify({'ok': False, 'error': '请提供旧密码或验证码'}), 400
            
            if current_password:
                # 验证旧密码
                if not current_user.check_password(current_password):
                    return jsonify({'ok': False, 'error': '旧密码不正确'}), 401
            
            elif otp_code:
                # 验证OTP
                otp = OTPCode.query.filter_by(
                    target=current_user.email,
                    channel='email',
                    purpose='password_change',
                    code=otp_code
                ).first()
                
                if not otp or otp.is_expired():
                    return jsonify({'ok': False, 'error': '验证码无效或已过期'}), 400
                
                # 删除已使用的验证码
                db.session.delete(otp)
        
        # 设置新密码
        current_user.set_password(new_password)
        db.session.commit()
        
        return jsonify({'ok': True})
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"密码更新失败: {e}", exc_info=True)
        return jsonify({'ok': False, 'error': '密码更新失败'}), 500

@bp.route('/auth/password/forgot/request', methods=['POST'])
def forgot_password_request():
    """忘记密码 - 请求验证码"""
    try:
        data = request.get_json()
        email = (data.get('email') or '').strip().lower()
        
        if not email:
            return jsonify({'ok': False, 'error': '请提供邮箱地址'}), 400
        
        # 检查用户是否存在
        user = User.query.filter(func.lower(User.email) == email).first()
        
        # 无论用户是否存在，都返回成功（防止邮箱枚举）
        if user:
            # 获取客户端IP
            client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)
            
            # 清理超限验证码
            disable_excessive_attempts()
            
            # 检查节流限制
            is_allowed, remaining = check_rate_limit(client_ip, email)
            if is_allowed:
                # 生成并发送验证码
                otp_code = create_otp_code(email, 'email', 'password_reset', client_ip)
                if otp_code:
                    success = send_otp_email(email, otp_code.code, 'password_reset')
                    if not success:
                        # 发送失败，删除验证码
                        db.session.delete(otp_code)
                        db.session.commit()
        
        return jsonify({'ok': True})
        
    except Exception as e:
        logging.error(f"忘记密码请求失败: {e}", exc_info=True)
        return jsonify({'ok': True})  # 始终返回成功，防止信息泄露

@bp.route('/auth/password/forgot/confirm', methods=['POST'])
def forgot_password_confirm():
    """忘记密码 - 确认验证码并设置新密码"""
    try:
        data = request.get_json()
        email = (data.get('email') or '').strip().lower()
        otp_code = data.get('otp_code', '').strip()
        new_password = data.get('new_password', '').strip()
        new_password_confirm = data.get('new_password_confirm', '').strip()
        
        if not all([email, otp_code, new_password, new_password_confirm]):
            return jsonify({'ok': False, 'error': '请填写完整信息'}), 400
        
        if new_password != new_password_confirm:
            return jsonify({'ok': False, 'error': '密码不符合要求或两次不一致'}), 400
        
        if len(new_password) < 8:
            return jsonify({'ok': False, 'error': '密码不符合要求或两次不一致'}), 400
        
        # 查找用户
        user = User.query.filter(func.lower(User.email) == email).first()
        if not user:
            return jsonify({'ok': False, 'error': '用户不存在'}), 404
        
        # 验证OTP
        otp = OTPCode.query.filter_by(
            target=email,
            channel='email',
            purpose='password_reset',
            code=otp_code
        ).first()
        
        if not otp or otp.is_expired():
            return jsonify({'ok': False, 'error': '验证码无效或已过期'}), 400
        
        # 设置新密码
        user.set_password(new_password)
        
        # 删除已使用的验证码
        db.session.delete(otp)
        db.session.commit()
        
        return jsonify({'ok': True})
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"忘记密码确认失败: {e}", exc_info=True)
        return jsonify({'ok': False, 'error': '密码重置失败'}), 500

@bp.route('/api/user/status', methods=['GET'])
def user_status():
    """检查当前用户登录状态"""
    if current_user.is_authenticated:
        # 是否需要绑定联系方式
        need_bind_contact = not current_user.has_contact_method() or not current_user.is_verified

        # 规范化订阅等级：把历史 'creator' 兼容为 'lite'
        raw_plan = current_user.plan if current_user.plan else ('pro' if getattr(current_user, 'has_premium', False) else 'free')
        plan_code = 'lite' if raw_plan == 'creator' else raw_plan
        if plan_code not in ('free', 'lite', 'pro'):
            plan_code = 'free'

        return jsonify({
            'isLoggedIn': True,
            'user': {
                'username': current_user.username,
                'email': current_user.email,
                'phone': current_user.phone,
                'is_verified': current_user.is_verified,
                'is_admin': current_user.is_admin,
                'has_premium': current_user.has_premium,
                'credits': current_user.credits,
                'plan': plan_code,                  # 兼容老前端
                'subscription_plan': plan_code,     # 新字段
                'avatar_path': getattr(current_user, 'avatar_path', None)  # 头像路径
            },
            'subscription': {
                'tier': plan_code                   # 设置面板直接用
            },
            # ★ 关键：补一个顶层 subscription_plan，修复前端 s.subscription_plan 为 undefined 的问题
            'subscription_plan': plan_code,
            # 新增：是否已在 Stripe 侧创建过 customer（free 但付过一次包也会有）
            'has_customer': bool(getattr(current_user, 'stripe_customer_id', None)),
            'need_bind_contact': need_bind_contact,
            'allow_password_login': ALLOW_PASSWORD_LOGIN,
            'allow_legacy_password_login': ALLOW_LEGACY_PASSWORD_LOGIN,
            'has_password': bool(current_user.password_hash),
            'enable_paid_voices': os.environ.get('ENABLE_PAID_VOICES', 'true').lower() == 'true'
        })
    else:
        return jsonify({
            'isLoggedIn': False,
            'allow_password_login': ALLOW_PASSWORD_LOGIN,
            'allow_legacy_password_login': ALLOW_LEGACY_PASSWORD_LOGIN,
            'enable_paid_voices': os.environ.get('ENABLE_PAID_VOICES', 'true').lower() == 'true'
        })

# --- 新增：邮箱绑定API ---

@bp.route('/account/email/request-code', methods=['POST'])
@login_required
def request_email_bind_code():
    """请求邮箱绑定验证码接口"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求体不能为空'}), 400
        
        email = data.get('email', '').strip().lower()
        if not email:
            return jsonify({'error': '请提供邮箱地址'}), 400
        
        # 验证邮箱格式
        if not validate_email(email):
            return jsonify({'error': '邮箱格式不正确'}), 400
        
        # 检查邮箱是否已被其他用户使用
        existing_user = User.query.filter_by(email=email).first()
        if existing_user and existing_user.id != current_user.id:
            return jsonify({'error': '该邮箱已被其他用户占用'}), 409
        
        # 获取客户端IP
        client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)
        
        # 清理超限验证码
        disable_excessive_attempts()
        
        # 检查节流限制
        is_allowed, remaining = check_rate_limit(client_ip, email)
        if not is_allowed:
            log_auth_event('request_bind_code', email, client_ip, current_user.id, False, 'Rate limited')
            return jsonify({'error': '发送过于频繁，请稍后再试'}), 429
        
        # 生成并保存验证码
        otp_code = create_otp_code(email, 'email', 'bind', client_ip)
        if not otp_code:
            return jsonify({'error': '验证码生成失败，请稍后重试'}), 500
        
        # 开发模式：打日志输出验证码
        logging.info(f"开发模式 - 邮箱绑定验证码已生成: {email} -> {otp_code.code}")
        
        # 发送验证码
        try:
            success = send_otp_email(email, otp_code.code, 'bind')
            
            if success:
                log_auth_event('request_bind_code', email, client_ip, current_user.id, True, 'Email bind code sent')
                return jsonify({'ok': True})
            else:
                # 发送失败，删除验证码
                db.session.delete(otp_code)
                db.session.commit()
                log_auth_event('request_bind_code', email, client_ip, current_user.id, False, 'Send failed')
                return jsonify({'error': '验证码发送失败'}), 500
                
        except Exception as send_e:
            logging.error(f"发送邮箱绑定验证码失败: {send_e}")
            return jsonify({'error': '验证码发送失败'}), 500
        
    except Exception as e:
        logging.error(f"请求邮箱绑定验证码失败: {e}", exc_info=True)
        return jsonify({'error': '请求验证码失败'}), 500

@bp.route('/account/email/verify', methods=['POST'])
@login_required
def verify_email_bind():
    """验证邮箱绑定接口"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求体不能为空'}), 400
        
        email = data.get('email', '').strip().lower()
        code = data.get('code', '').strip()
        
        if not email or not code:
            return jsonify({'error': '缺少必要参数'}), 400
        
        # 验证邮箱格式
        if not validate_email(email):
            return jsonify({'error': '邮箱格式不正确'}), 400
        
        # 再次检查邮箱是否已被其他用户使用
        existing_user = User.query.filter_by(email=email).first()
        if existing_user and existing_user.id != current_user.id:
            return jsonify({'error': '该邮箱已被其他用户占用'}), 409
        
        # 获取客户端IP
        client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)
        
        # 验证验证码
        success, message, otp_code = verify_otp_code(email, code, 'bind')
        if not success:
            log_auth_event('verify_bind_code', email, client_ip, current_user.id, False, message)
            return jsonify({'error': message}), 400
        
        # 绑定邮箱到当前用户
        current_user.email = email
        current_user.is_verified = True
        current_user.verified_at = datetime.datetime.utcnow()
        db.session.commit()
        
        log_auth_event('verify_bind_code', email, client_ip, current_user.id, True, 'Email bound successfully')
        logging.info(f"用户 {current_user.username} 成功绑定邮箱: {email}")
        
        return jsonify({'ok': True})
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"验证邮箱绑定失败: {e}", exc_info=True)
        return jsonify({'error': '验证邮箱绑定失败'}), 500

# --- 新增：统一认证API ---

@bp.route('/auth/request-code', methods=['POST'])
def request_code_api():
    """请求验证码接口"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求体不能为空'}), 400
        
        target = data.get('target', '').strip()
        channel = data.get('channel', '').strip()
        purpose = data.get('purpose', 'login')  # 'register' | 'login'
        
        if not target:
            return jsonify({'error': '请提供邮箱或手机号'}), 400
        
        if channel not in ['email', 'phone']:
            return jsonify({'error': '无效的发送通道'}), 400
        
        # 规范化target
        target = normalize_target(target, channel)
        
        # 验证格式
        if channel == 'email' and not validate_email(target):
            return jsonify({'error': '邮箱格式不正确'}), 400
        elif channel == 'phone' and not validate_phone(target):
            return jsonify({'error': '手机号格式不正确'}), 400
        
        # 如果是注册，检查用户是否已存在
        if purpose == 'register':
            existing_user = None
            if channel == 'email':
                existing_user = User.query.filter_by(email=target).first()
            else:
                existing_user = User.query.filter_by(phone=target).first()
            
            if existing_user:
                return jsonify({'error': '该邮箱或手机号已被注册'}), 409
        
        # 获取客户端IP
        client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)
        
        # 清理超限验证码
        disable_excessive_attempts()
        
        # 检查节流限制
        is_allowed, remaining = check_rate_limit(client_ip, target)
        if not is_allowed:
            log_auth_event('request_code', target, client_ip, None, False, 'Rate limited')
            return jsonify({'error': '发送过于频繁，请稍后再试'}), 429
        
        # 生成并保存验证码
        otp_code = create_otp_code(target, channel, purpose, client_ip)
        if not otp_code:
            return jsonify({'error': '验证码生成失败，请稍后重试'}), 500
        
        # 开发模式：打日志输出验证码
        logging.info(f"开发模式 - 验证码已生成: {target} -> {otp_code.code}")
        
        # 模拟发送（生产环境需要接入真实的邮件/短信服务）
        try:
            if channel == 'email':
                success = send_otp_email(target, otp_code.code, purpose)
            else:
                success = send_otp_sms(target, otp_code.code, purpose)
            
            if success:
                log_auth_event('request_code', target, client_ip, None, True, f'{channel} code sent')
                return jsonify({'ok': True})
            else:
                # 发送失败，删除验证码
                db.session.delete(otp_code)
                db.session.commit()
                log_auth_event('request_code', target, client_ip, None, False, 'Send failed')
                return jsonify({'error': '验证码发送失败'}), 500
        except Exception as send_e:
            logging.error(f"发送验证码失败: {send_e}")
            return jsonify({'error': '验证码发送失败'}), 500
        
    except Exception as e:
        logging.error(f"请求验证码失败: {e}", exc_info=True)
        return jsonify({'error': '请求验证码失败'}), 500

@bp.route('/auth/verify-code', methods=['POST'])
def verify_code_api():
    """验证验证码接口"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求体不能为空'}), 400
        
        target = data.get('target', '').strip()
        channel = data.get('channel', '').strip()
        code = data.get('code', '').strip()
        purpose = data.get('purpose', 'login')
        password = data.get('password')  # 可选的密码参数
        
        if not all([target, channel, code]):
            return jsonify({'error': '缺少必要参数'}), 400
        
        if channel not in ['email', 'phone']:
            return jsonify({'error': '无效的发送通道'}), 400
        
        # 规范化target
        target = normalize_target(target, channel)
        
        # 获取客户端IP
        client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)
        
        # 验证验证码
        success, message, otp_code = verify_otp_code(target, code, purpose)
        if not success:
            log_auth_event('verify_code', target, client_ip, None, False, message)
            return jsonify({'error': message}), 400
        
        if purpose == 'register':
            # 注册逻辑
            # 检查用户是否已存在
            existing_user = None
            if channel == 'email':
                existing_user = User.query.filter_by(email=target).first()
            else:
                existing_user = User.query.filter_by(phone=target).first()
            
            if existing_user:
                # 用户存在但未验证，标记为已验证
                if not existing_user.is_verified:
                    existing_user.is_verified = True
                    existing_user.verified_at = datetime.datetime.utcnow()
                    db.session.commit()
                    logging.info(f"用户 {existing_user.username} 验证状态已更新")
                
                # 建立会话
                login_user(existing_user)
                return jsonify({'ok': True})
            else:
                # 创建新用户
                # 生成用户名（使用邮箱前缀或手机号后4位）
                if channel == 'email':
                    username_base = target.split('@')[0]
                else:
                    username_base = f"user{target[-4:]}"
                
                # 确保用户名唯一
                counter = 1
                username = username_base
                while User.query.filter_by(username=username).first():
                    username = f"{username_base}{counter}"
                    counter += 1
                
                new_user = User(username=username)
                if password:
                    new_user.set_password(password)
                
                if channel == 'email':
                    new_user.email = target
                else:
                    new_user.phone = target
                
                new_user.is_verified = True
                new_user.verified_at = datetime.datetime.utcnow()
                
                db.session.add(new_user)
                db.session.commit()
                
                # 创建API密钥记录
                new_api_key_record = UserAPIKey(user_id=new_user.id)
                db.session.add(new_api_key_record)
                db.session.commit()
                
                logging.info(f"新用户创建成功: {username} ({target})")
                
                # 建立会话
                login_user(new_user)
                log_auth_event('register', target, client_ip, new_user.id, True, f'New user created via {channel}')
                return jsonify({'ok': True})
        
        elif purpose == 'login':
            # 登录逻辑
            user = None
            if channel == 'email':
                user = User.query.filter_by(email=target).first()
            else:
                user = User.query.filter_by(phone=target).first()
            
            if not user:
                # 可选：首次即创建用户（这里先返回404）
                return jsonify({'error': '用户不存在'}), 404
            
            # 建立会话
            login_user(user)
            log_auth_event('login', target, client_ip, user.id, True, f'OTP login via {channel}')
            return jsonify({'ok': True})
        
        return jsonify({'error': '无效的purpose参数'}), 400
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"验证验证码失败: {e}", exc_info=True)
        return jsonify({'error': '验证验证码失败'}), 500

# --- 新增：OTP 验证码相关API ---

@bp.route('/api/send-otp', methods=['POST'])
def send_otp_api():
    """发送 OTP 验证码"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求体不能为空'}), 400
        
        target = data.get('target', '').strip()
        purpose = data.get('purpose', 'login')  # 'register' | 'login'
        
        if not target:
            return jsonify({'error': '请提供邮箱或手机号'}), 400
        
        # 判断是邮箱还是手机号
        if validate_email(target):
            channel = 'email'
        elif validate_phone(target):
            channel = 'phone'
        else:
            return jsonify({'error': '请提供有效的邮箱或手机号'}), 400
        
        # 如果是注册，检查是否已存在
        if purpose == 'register':
            existing_user = None
            if channel == 'email':
                existing_user = User.query.filter_by(email=target).first()
            else:
                existing_user = User.query.filter_by(phone=target).first()
            
            if existing_user:
                return jsonify({'error': '该邮箱或手机号已被注册'}), 409
        
        # 获取客户端 IP
        client_ip = request.environ.get('HTTP_X_REAL_IP', request.remote_addr)
        
        # 发送验证码
        success, message = send_otp_code(target, channel, purpose, client_ip)
        
        if success:
            return jsonify({'message': message})
        else:
            return jsonify({'error': message}), 429
            
    except Exception as e:
        logging.error(f"发送 OTP 失败: {e}", exc_info=True)
        return jsonify({'error': '发送验证码失败'}), 500

@bp.route('/api/verify-otp', methods=['POST'])
def verify_otp_api():
    """验证 OTP 验证码"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求体不能为空'}), 400
        
        target = data.get('target', '').strip()
        code = data.get('code', '').strip()
        purpose = data.get('purpose', 'login')
        
        if not target or not code:
            return jsonify({'error': '请提供邮箱/手机号和验证码'}), 400
        
        # 验证验证码
        success, message, otp_code = verify_otp_code(target, code, purpose)
        
        if not success:
            return jsonify({'error': message}), 400
        
        # 验证成功的处理
        if purpose == 'register':
            # 注册流程：验证码验证成功，等待用户完成注册
            return jsonify({
                'message': '验证码验证成功',
                'verified': True,
                'target': target,
                'channel': otp_code.channel if otp_code else None
            })
        else:
            # 登录流程：查找用户并登录
            user = None
            if validate_email(target):
                user = User.query.filter_by(email=target).first()
            elif validate_phone(target):
                user = User.query.filter_by(phone=target).first()
            
            if not user:
                return jsonify({'error': '用户不存在'}), 404
            
            # 登录用户
            login_user(user)
            logging.info(f"用户通过 OTP 登录成功: {user.username}")
            
            return jsonify({
                'message': '登录成功',
                'user': {
                    'username': user.username,
                    'email': user.email,
                    'phone': user.phone,
                    'is_verified': user.is_verified
                }
            })
            
    except Exception as e:
        logging.error(f"验证 OTP 失败: {e}", exc_info=True)
        return jsonify({'error': '验证码验证失败'}), 500

@bp.route('/api/register-with-otp', methods=['POST'])
def register_with_otp():
    """使用已验证的邮箱/手机号完成注册"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '请求体不能为空'}), 400
        
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        password_confirm = data.get('password_confirm', '').strip()
        target = data.get('target', '').strip()  # 已验证的邮箱或手机号
        channel = data.get('channel', '').strip()  # 'email' 或 'phone'
        
        if not all([username, target, channel]):
            return jsonify({'error': '缺少必要参数'}), 400
        
        # 密码验证逻辑
        if password or password_confirm:
            if not password or not password_confirm:
                return jsonify({'ok': False, 'error': '密码不符合要求或两次不一致'}), 400
            
            if password != password_confirm:
                return jsonify({'ok': False, 'error': '密码不符合要求或两次不一致'}), 400
            
            if len(password) < 8:
                return jsonify({'ok': False, 'error': '密码不符合要求或两次不一致'}), 400
        
        # 检查用户名是否已存在
        if User.query.filter_by(username=username).first():
            return jsonify({'error': '用户名已存在'}), 409
        
        # 检查邮箱/手机号是否已被注册
        existing_user = None
        if channel == 'email':
            existing_user = User.query.filter_by(email=target).first()
        elif channel == 'phone':
            existing_user = User.query.filter_by(phone=target).first()
        
        if existing_user:
            return jsonify({'error': '该邮箱或手机号已被注册'}), 409
        
        # 创建新用户
        new_user = User(username=username)
        if password:  # 只有在设置了密码时才设置密码哈希
            new_user.set_password(password)
        new_user.is_verified = True  # 因为已通过 OTP 验证
        new_user.verified_at = datetime.datetime.utcnow()
        
        if channel == 'email':
            new_user.email = target
        else:
            new_user.phone = target
        
        db.session.add(new_user)
        db.session.commit()
        
        # 为新用户创建 API 密钥记录
        new_api_key_record = UserAPIKey(user_id=new_user.id)
        db.session.add(new_api_key_record)
        db.session.commit()
        
        logging.info(f"新用户通过 OTP 注册成功: {username} ({target})")
        
        # 自动登录
        login_user(new_user)
        
        return jsonify({
            'message': '注册成功',
            'user': {
                'username': new_user.username,
                'email': new_user.email,
                'phone': new_user.phone,
                'is_verified': new_user.is_verified
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        logging.error(f"OTP 注册失败: {e}", exc_info=True)
        return jsonify({'error': '注册失败'}), 500

# --- 其他API接口 ---


@bp.route('/api/user/update-profile', methods=['POST'])
@login_required
def update_user_profile():
    """更新用户个人资料（用户名和头像）"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': '无效的请求数据'}), 400
        
        # 获取要更新的字段
        new_username = data.get('username', '').strip()
        new_avatar = data.get('avatar')  # base64编码的图片数据
        
        # 验证用户名
        if not new_username:
            return jsonify({'error': '用户名不能为空'}), 400
        
        if len(new_username) < 2 or len(new_username) > 20:
            return jsonify({'error': '用户名长度应在2-20个字符之间'}), 400
        
        # 检查用户名是否已被其他用户使用
        existing_user = User.query.filter(
            User.username == new_username,
            User.id != current_user.id
        ).first()
        
        if existing_user:
            return jsonify({'error': '用户名已被使用'}), 400
        
        # 更新用户名
        current_user.username = new_username
        
        # 处理头像更新
        if new_avatar:
            try:
                # 解析base64数据
                if new_avatar.startswith('data:image/'):
                    # 移除data:image/xxx;base64,前缀
                    header, encoded = new_avatar.split(',', 1)
                    image_data = base64.b64decode(encoded)
                else:
                    image_data = base64.b64decode(new_avatar)
                
                # 生成唯一的文件名
                file_extension = 'png'  # 默认PNG格式
                if 'image/jpeg' in header or 'image/jpg' in header:
                    file_extension = 'jpg'
                elif 'image/gif' in header:
                    file_extension = 'gif'
                
                filename = f"avatar_{current_user.id}_{int(datetime.datetime.now().timestamp())}.{file_extension}"
                avatar_path = os.path.join('static', 'avatars', filename)
                
                # 确保目录存在
                os.makedirs(os.path.dirname(avatar_path), exist_ok=True)
                
                # 保存头像文件
                with open(avatar_path, 'wb') as f:
                    f.write(image_data)
                
                # 更新用户头像路径（相对路径，用于前端显示）
                current_user.avatar_path = f'/static/avatars/{filename}'
                
            except Exception as e:
                current_app.logger.error(f"保存头像失败: {e}")
                return jsonify({'error': '头像保存失败'}), 500
        
        # 保存到数据库
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': '个人资料更新成功',
            'user': {
                'username': current_user.username,
                'avatar_path': getattr(current_user, 'avatar_path', None)
            }
        })
        
    except Exception as e:
        current_app.logger.error(f"更新用户资料失败: {e}")
        db.session.rollback()
        return jsonify({'error': '更新失败，请重试'}), 500



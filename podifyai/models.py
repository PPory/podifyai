from werkzeug.security import check_password_hash, generate_password_hash

import datetime
import uuid

from flask_login import UserMixin
from sqlalchemy.ext.hybrid import hybrid_property

from .extensions import db


class User(UserMixin, db.Model):
    __tablename__ = 'user'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True, nullable=False)
    password_hash = db.Column(db.String(256))
    email = db.Column(db.String(255), unique=True, index=True, nullable=True)
    phone = db.Column(db.String(32), unique=True, index=True, nullable=True)
    is_verified = db.Column(db.Boolean, default=False, nullable=False)
    verified_at = db.Column(db.DateTime, nullable=True)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    has_premium = db.Column(db.Boolean, default=False, nullable=False)
    credits = db.Column(db.Integer, default=50, nullable=False)
    plan = db.Column(db.String(20), default='free', nullable=False)
    stripe_customer_id = db.Column(db.String(64), nullable=True)
    stripe_subscription_id = db.Column(db.String(64), nullable=True)
    avatar_path = db.Column(db.String(255), nullable=True)

    api_keys = db.relationship('UserAPIKey', backref='user', lazy='dynamic', cascade='all, delete-orphan')
    voices = db.relationship('Voice', backref='owner', lazy='dynamic', cascade='all, delete-orphan')
    history_items = db.relationship('History', backref='owner', lazy='dynamic', cascade='all, delete-orphan')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def has_contact_method(self):
        return bool(self.email or self.phone)

    def get_contact_for_otp(self):
        if self.email:
            return self.email, 'email'
        if self.phone:
            return self.phone, 'phone'
        return None, None

    def __repr__(self):
        return f'<User {self.username}>'


class OTPCode(db.Model):
    __tablename__ = 'otp_code'

    id = db.Column(db.Integer, primary_key=True)
    target = db.Column(db.String(255), index=True, nullable=False)
    channel = db.Column(db.String(10), nullable=False)
    code = db.Column(db.String(6), nullable=False)
    purpose = db.Column(db.String(32), default='login', nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    attempts = db.Column(db.Integer, default=0, nullable=False)
    ip = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)

    def is_expired(self):
        return datetime.datetime.utcnow() > self.expires_at

    def is_attempts_exceeded(self, max_attempts=5):
        return self.attempts >= max_attempts

    def increment_attempts(self):
        self.attempts += 1
        db.session.commit()

    def verify_code(self, input_code):
        return self.code == input_code

    @staticmethod
    def cleanup_expired():
        expired_codes = OTPCode.query.filter(OTPCode.expires_at < datetime.datetime.utcnow()).all()
        for code in expired_codes:
            db.session.delete(code)
        db.session.commit()
        return len(expired_codes)


class UserAPIKey(db.Model):
    __tablename__ = 'user_api_key'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    gemini_key = db.Column(db.String(256))
    gemini_base = db.Column(db.String(256))
    siliconflow_key = db.Column(db.String(256))
    siliconflow_base = db.Column(db.String(256))


class Voice(db.Model):
    __tablename__ = 'voice'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    name = db.Column(db.String(128), nullable=False)
    text = db.Column(db.Text, nullable=False)
    audio_path = db.Column(db.String(256), nullable=False)
    type = db.Column(db.String(32), nullable=False)
    description = db.Column(db.String(256))
    is_global = db.Column(db.Boolean, default=False, nullable=False, index=True)
    voice_uri = db.Column(db.String(256), nullable=True)
    source_model = db.Column(db.String(128), nullable=True, default='FunAudioLLM/CosyVoice2-0.5B')


class History(db.Model):
    __tablename__ = 'history'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    title = db.Column(db.String(256))
    script_full = db.Column(db.Text)
    audio_filename = db.Column(db.String(256), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow, index=True)
    mode = db.Column(db.String(32))
    voice_name = db.Column(db.String(128))
    duration = db.Column(db.Float)
    play_count = db.Column(db.Integer, default=0)
    thumbnail_filename = db.Column(db.String(256))
    source_url = db.Column(db.String(512))
    source_title = db.Column(db.String(256))
    source_type = db.Column(db.String(32))
    original_input = db.Column(db.Text)
    input_type = db.Column(db.String(32))
    voice_id_used = db.Column(db.Integer, db.ForeignKey('voice.id'), nullable=True)
    voice_uri_used = db.Column(db.String(256), nullable=True)


class CreditTxn(db.Model):
    __tablename__ = 'credit_ledger'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    delta = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(32), nullable=False)
    ref = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False, index=True)

    owner = db.relationship('User', backref=db.backref('credit_txns', lazy='dynamic'))

    @hybrid_property
    def amount(self):
        return self.delta

    @amount.setter
    def amount(self, value):
        self.delta = value

    @property
    def balance_after(self):
        return None

    @property
    def ref_id(self):
        return self.ref

    @ref_id.setter
    def ref_id(self, value):
        self.ref = value


class SubscriptionPlan(db.Model):
    __tablename__ = 'subscription_plan'

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(32), unique=True, nullable=False)
    name = db.Column(db.String(64), nullable=False)
    monthly_price_cents = db.Column(db.Integer, nullable=False)
    credits_per_month = db.Column(db.Integer, nullable=False)
    currency = db.Column(db.String(8), default='usd')


class Subscription(db.Model):
    __tablename__ = 'subscription'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    plan_id = db.Column(db.Integer, db.ForeignKey('subscription_plan.id'), nullable=False)
    status = db.Column(db.String(16))
    current_period_end = db.Column(db.DateTime, nullable=False)
    provider = db.Column(db.String(16))
    customer_id = db.Column(db.String(64))
    subscription_id = db.Column(db.String(64))

    owner = db.relationship('User', backref=db.backref('subscription_records', lazy='dynamic'))
    plan_ref = db.relationship('SubscriptionPlan', backref=db.backref('subscriptions', lazy='dynamic'))

    @property
    def plan(self):
        return self.plan_ref.code if self.plan_ref else None

    @property
    def stripe_customer_id(self):
        return self.customer_id

    @stripe_customer_id.setter
    def stripe_customer_id(self, value):
        self.customer_id = value

    @property
    def stripe_subscription_id(self):
        return self.subscription_id

    @stripe_subscription_id.setter
    def stripe_subscription_id(self, value):
        self.subscription_id = value

    @property
    def cancel_at_period_end(self):
        return self.status == 'cancel_at_period_end'

    @property
    def updated_at(self):
        return self.current_period_end


class StripeEventLog(db.Model):
    __tablename__ = 'stripe_event_log'

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.String(128), unique=True, index=True, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    kind = db.Column(db.String(64), default='checkout.session.completed')
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

import logging
import os

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS

from auth import bp as auth_bp
from billing import _ensure_user_columns, _validate_stripe_config, bp as billing_bp
from content import bp as content_bp
from extensions import db, login_manager, migrate
from history import bp as history_bp
from models import CreditTxn, History, OTPCode, StripeEventLog, Subscription, SubscriptionPlan, User, UserAPIKey, Voice
from services import cleanup_stale_alembic_temp_tables, init_database, load_keys_on_startup, reconcile_alembic_heads, send_email_via_sendgrid, send_otp_email
from static_routes import bp as static_routes_bp
from tts import bp as tts_bp
from voices import bp as voices_bp

load_dotenv('.env.local', override=True)


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


def create_app():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        force=True,
    )

    app = Flask(__name__)
    app.logger.handlers = logging.getLogger().handlers
    app.logger.setLevel(logging.INFO)

    app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')
    if not app.config['SECRET_KEY'] or app.config['SECRET_KEY'].strip().lower() in {'changeme', 'change_me'}:
        app.logger.warning('SECURITY: SECRET_KEY is missing or insecure. Set SECRET_KEY in your environment!')

    allowed = os.environ.get('ALLOWED_ORIGINS', '').strip()
    origins = [o.strip() for o in allowed.split(',') if o.strip()] if allowed else [
        'http://127.0.0.1:5000',
        'http://localhost:5000',
    ]
    CORS(app, resources={r'/*': {'origins': origins, 'supports_credentials': True}})

    app.config.setdefault('SESSION_COOKIE_SAMESITE', 'Lax')
    app.config.setdefault('SESSION_COOKIE_SECURE', os.environ.get('SESSION_COOKIE_SECURE', 'true').lower() != 'false')

    basedir = os.path.abspath(os.path.dirname(__file__))
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'app.db')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    login_manager.login_view = 'static_routes.login_page'

    app.register_blueprint(auth_bp)
    app.register_blueprint(voices_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(tts_bp)
    app.register_blueprint(billing_bp)
    app.register_blueprint(content_bp)
    app.register_blueprint(static_routes_bp)

    with app.app_context():
        load_keys_on_startup()
        cleanup_stale_alembic_temp_tables()
        init_database()
        reconcile_alembic_heads()
        _ensure_user_columns()
        _validate_stripe_config()

    return app


app = create_app()


__all__ = [
    'app',
    'create_app',
    'db',
    'User',
    'OTPCode',
    'UserAPIKey',
    'Voice',
    'History',
    'CreditTxn',
    'SubscriptionPlan',
    'Subscription',
    'StripeEventLog',
    'send_email_via_sendgrid',
    'send_otp_email',
]


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)




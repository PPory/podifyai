# MOSS-TTSD 配置文件
import os

# 基本配置
SECRET_KEY = 'your-secret-key-here'
DATABASE_URL = 'sqlite:///app.db'

# 积分系统配置
CREDITS_PER_AUDIO = 10

# 邮件配置
OTP_DEV_LOG_ONLY = True
EMAIL_PROVIDER = 'smtp'

# TTS配置
SF_TTS_MODEL = 'fnlp/MOSS-TTSD-v0.5'
SF_TTS_MAX_TOKENS = 16384
SF_TTS_FORMAT = 'mp3'

# 认证配置
ALLOW_LEGACY_PASSWORD_LOGIN = True
ALLOW_PASSWORD_LOGIN = True
REQUIRE_CONTACT_VERIFICATION = False

# OpenAI配置
OPENAI_API_KEY = 'your-openai-api-key'
OPENAI_API_BASE = 'https://api.openai.com/v1'

# Stripe配置
STRIPE_PUBLISHABLE_KEY = 'pk_test_your-publishable-key'
STRIPE_SECRET_KEY = 'sk_test_your-secret-key'
STRIPE_WEBHOOK_SECRET = 'whsec_your-webhook-secret'


# app.py - 集成数据库和用户系统的重构版

import os, shutil, subprocess
FFMPEG_DIR = r"E:\ffmpeg\ffmpeg-8.0-essentials_build\bin"  # ← 改成你实际的 bin 目录
os.environ["PATH"] = FFMPEG_DIR + os.pathsep + os.environ.get("PATH", "")
os.environ["FFMPEG_BINARY"] = os.path.join(FFMPEG_DIR, "ffmpeg.exe")  # 给 pydub 一个明确路径
import base64
import uuid
import logging
import requests
import tempfile
import datetime
import shutil
from pathlib import Path
# import json # 不再需要 json
import io
import re
import secrets
import smtplib
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from collections import defaultdict
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from openai import OpenAI
from bs4 import BeautifulSoup
import fitz  # PyMuPDF
from mutagen import File
from pydub import AudioSegment
from pydub.silence import detect_nonsilent
import numpy as np
import random
import time
import traceback
from typing import Optional

# WebRTC VAD 用于语音活动检测
try:
    import webrtcvad
    _HAS_VAD = True
except Exception:
    _HAS_VAD = False

# --- 新增的库 ---
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import text, or_, func

# 使用 dotenv 加载 .env.local 文件，确保覆盖系统环境变量
try:
    from dotenv import load_dotenv
    load_dotenv('.env.local', override=True)  # 关键：override=True
    logging.info("成功加载 .env.local 配置文件")
except ImportError:
    logging.warning("dotenv 库未安装，使用手动加载方式")
    # 备用加载方式
    def load_env_file():
        """加载 .env.local 文件中的环境变量"""
        env_file = '.env.local'
        if os.path.exists(env_file):
            try:
                with open(env_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            key, value = line.split('=', 1)
                            os.environ[key] = value
                logging.info("成功加载 .env.local 配置文件")
            except Exception as e:
                logging.warning(f"加载 .env.local 失败: {e}")
    load_env_file()
except Exception as e:
    logging.warning(f"加载 .env.local 失败: {e}")

# ------------------------- 1. 配置与初始化 -------------------------

# 配置日志
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s',
                    force=True)

# 初始化 Flask 应用
app = Flask(__name__)

# 让 Flask 的 app.logger 与根 logger 一致
app.logger.handlers = logging.getLogger().handlers
app.logger.setLevel(logging.INFO)

# --- Security & CORS hardening ---
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY')  # no default
if not app.config['SECRET_KEY'] or app.config['SECRET_KEY'].strip().lower() in {'changeme', 'change_me'}:
    # 在开发环境允许运行但打印警告；生产直接抛错更稳妥，如需可改为抛 RuntimeError
    app.logger.warning('SECURITY: SECRET_KEY is missing or insecure. Set SECRET_KEY in your environment!')

# 允许的前端来源（逗号分隔），例：http://127.0.0.1:5000,http://localhost:5000,https://podify.ai
_allowed = os.environ.get('ALLOWED_ORIGINS', '').strip()
if _allowed:
    origins = [o.strip() for o in _allowed.split(',') if o.strip()]
else:
    # 开发期默认仅放本机端口（可按需调整）
    origins = ['http://127.0.0.1:5000', 'http://localhost:5000']

CORS(app, resources={r"/*": {"origins": origins, "supports_credentials": True}})

# 更安全的 Cookie（生产部署时建议设为 True）
app.config.setdefault('SESSION_COOKIE_SAMESITE', 'Lax')
app.config.setdefault('SESSION_COOKIE_SECURE', False)  # 生产用 HTTPS 时改 True

# ------------------------- URL抽取系统配置 -------------------------

# 公共配置 & 工具
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)
UPSTREAM_TIMEOUT = 20
MIN_ARTICLE_CHARS = int(os.getenv("MIN_ARTICLE_CHARS", "200"))
ALLOW_TEXT_MIRROR = True  # 如需严格遵守来源站点 ToS，可置 False 关闭镜像兜底

# 积分系统配置
CREDITS_PER_AUDIO = int(os.environ.get('CREDITS_PER_AUDIO', '10').split('#')[0].strip())

HTTP_HEADERS = {
    "user-agent": DEFAULT_UA,
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# --- 新增：数据库和登录管理器配置 ---
# 获取当前文件所在目录
basedir = os.path.abspath(os.path.dirname(__file__))
# 配置数据库URI
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'app.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# 初始化扩展
db = SQLAlchemy(app)
migrate = Migrate(app, db)
login_manager = LoginManager(app)
# 如果用户未登录时访问受保护的页面，将他们重定向到 'login' 视图
login_manager.login_view = 'login' 


# --- 新增：数据库模型定义 ---

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), index=True, unique=True, nullable=False)
    password_hash = db.Column(db.String(256))
    
    # 新增：邮箱/手机号验证体系
    email = db.Column(db.String(255), unique=True, index=True, nullable=True)
    phone = db.Column(db.String(32), unique=True, index=True, nullable=True)
    is_verified = db.Column(db.Boolean, default=False, nullable=False)
    verified_at = db.Column(db.DateTime, nullable=True)
    
    # 新增：管理员和付费用户标记
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    has_premium = db.Column(db.Boolean, default=False, nullable=False)
    
    # 新增：积分系统
    credits = db.Column(db.Integer, default=50, nullable=False)  # 默认50积分
    
    # 新增：Stripe 订阅相关字段
    plan = db.Column(db.String(20), default='free', nullable=False)  # 'free', 'lite', 'pro'
    stripe_customer_id = db.Column(db.String(64), nullable=True)
    stripe_subscription_id = db.Column(db.String(64), nullable=True)
    
    # 新增：用户头像
    avatar_path = db.Column(db.String(255), nullable=True)

    # 关系：一个用户可以有多个API密钥、音色和历史记录
    api_keys = db.relationship('UserAPIKey', backref='user', lazy='dynamic', cascade="all, delete-orphan")
    voices = db.relationship('Voice', backref='owner', lazy='dynamic', cascade="all, delete-orphan")
    history_items = db.relationship('History', backref='owner', lazy='dynamic', cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def has_contact_method(self):
        """检查用户是否有联系方式（邮箱或手机）"""
        return bool(self.email or self.phone)
    
    def get_contact_for_otp(self):
        """获取用于 OTP 的联系方式，优先邮箱"""
        if self.email:
            return self.email, 'email'
        elif self.phone:
            return self.phone, 'phone'
        return None, None

    def __repr__(self):
        return f'<User {self.username}>'

class OTPCode(db.Model):
    """OTP 验证码模型，用于邮箱/手机验证"""
    id = db.Column(db.Integer, primary_key=True)
    target = db.Column(db.String(255), index=True, nullable=False)  # email 或 phone
    channel = db.Column(db.String(10), nullable=False)  # 'email' | 'phone'
    code = db.Column(db.String(6), nullable=False)
    purpose = db.Column(db.String(32), default='login', nullable=False)  # 'register' | 'login' 等
    expires_at = db.Column(db.DateTime, nullable=False)
    attempts = db.Column(db.Integer, default=0, nullable=False)
    ip = db.Column(db.String(64))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)
    
    def is_expired(self):
        """检查验证码是否已过期"""
        return datetime.datetime.utcnow() > self.expires_at
    
    def is_attempts_exceeded(self, max_attempts=5):
        """检查尝试次数是否超过限制"""
        return self.attempts >= max_attempts
    
    def increment_attempts(self):
        """增加尝试次数"""
        self.attempts += 1
        db.session.commit()
    
    def verify_code(self, input_code):
        """验证输入的验证码"""
        return self.code == input_code
    
    @staticmethod
    def cleanup_expired():
        """清理过期的验证码"""
        expired_codes = OTPCode.query.filter(OTPCode.expires_at < datetime.datetime.utcnow()).all()
        for code in expired_codes:
            db.session.delete(code)
        db.session.commit()
        return len(expired_codes)

class UserAPIKey(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    # 注意：在生产环境中，这些密钥应该被加密存储。为了简化，我们这里暂时明文存储。
    gemini_key = db.Column(db.String(256))
    gemini_base = db.Column(db.String(256))
    siliconflow_key = db.Column(db.String(256))
    siliconflow_base = db.Column(db.String(256))

class Voice(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(128), nullable=False)
    text = db.Column(db.Text, nullable=False)
    audio_path = db.Column(db.String(256), nullable=False)
    type = db.Column(db.String(32), nullable=False) # 'role' or 'single'
    description = db.Column(db.String(256))
    
    # 新增：全站共享标记
    is_global = db.Column(db.Boolean, default=False, nullable=False)
    
    # 新增：SiliconFlow预置音色URI（优先使用）
    voice_uri = db.Column(db.String(256), nullable=True)  # speech:your-voice-name:...
    source_model = db.Column(db.String(128), nullable=True, default="fnlp/MOSS-TTSD-v0.5")

class History(db.Model):
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(256))
    script_full = db.Column(db.Text)
    audio_filename = db.Column(db.String(256), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    mode = db.Column(db.String(32))
    voice_name = db.Column(db.String(128))
    duration = db.Column(db.Float)
    play_count = db.Column(db.Integer, default=0)
    thumbnail_filename = db.Column(db.String(256))
    # 新增：来源字段
    source_url = db.Column(db.String(512))
    # 新增：首音到达时间指标（毫秒）
    speech_onset_ms = db.Column(db.Integer, default=0)
    source_title = db.Column(db.String(256))
    source_type = db.Column(db.String(32))   # 'manual' | 'url' | 'pdf' 等
    # 新增：原始输入字段
    original_input = db.Column(db.Text)  # 用户最初输入的原始文本
    input_type = db.Column(db.String(32))  # 'text' | 'url' | 'pdf' | 'manual'
    # 新增：音色溯源字段
    voice_id_used = db.Column(db.Integer, db.ForeignKey('voice.id'), nullable=True)  # 实际使用的音色ID
    voice_uri_used = db.Column(db.String(256), nullable=True)  # 实际使用的音色URI（如果有）

# --------------------------------------------
# 一次性小表：记录已处理的 session/event，做幂等
class StripeEventLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.String(128), unique=True, index=True, nullable=False)  # 这里存 session_id
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    kind = db.Column(db.String(64), default='checkout.session.completed')
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

# --- 新增：Flask-Login 需要的用户加载函数 ---
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

# ------------------------- URL抽取系统函数 -------------------------

def normalize_url(url: str) -> str:
    """通用规范化：去除片段、无意义参数等"""
    try:
        p = urlparse(url.strip())
        if not p.scheme:
            p = p._replace(scheme="https")
        # 去掉 hash
        p = p._replace(fragment="")
        return urlunparse(p)
    except Exception:
        return url

def resolve_canonical_or_amp(url: str) -> str:
    """
    抓取一次，尝试读取 <link rel='canonical'> 或 <link rel='amphtml'>，返回更"干净"的正文页。
    """
    try:
        r = requests.get(url, headers=HTTP_HEADERS, timeout=UPSTREAM_TIMEOUT, allow_redirects=True)
        if not r.ok:
            return url
        soup = BeautifulSoup(r.text, "html.parser")
        # 优先 canonical
        link = soup.find("link", rel=lambda v: v and "canonical" in v.lower())
        if link and link.get("href"):
            return link["href"]
        # 其次 amphtml（很多站点的 AMP 比主站更易抽取）
        link = soup.find("link", rel=lambda v: v and "amphtml" in v.lower())
        if link and link.get("href"):
            return link["href"]
        return url
    except Exception:
        return url

def resolve_special(url: str) -> str:
    """
    站点特例（可拓展的 resolver 链）
    - Substack /home/post/p-xxxxx → 调内部 API 或 __NEXT_DATA__ 拿 canonical_url
    - Medium 优先用 AMP（大多更纯净）
    """
    # Substack 聚合页 → 文章页
    if "substack.com/home/post/p-" in url:
        try:
            post_id = re.search(r"/home/post/(p-\d+)", url).group(1)
            api = f"https://substack.com/api/v1/post/{post_id}"
            r = requests.get(api, headers=HTTP_HEADERS, timeout=15)
            if r.ok:
                data = r.json()
                canonical = (data.get("canonical_url") or data.get("post", {}).get("canonical_url"))
                if canonical:
                    return canonical
        except Exception:
            # __NEXT_DATA__ 兜底
            try:
                r = requests.get(url, headers=HTTP_HEADERS, timeout=15)
                soup = BeautifulSoup(r.text, "html.parser")
                s = soup.find("script", id="__NEXT_DATA__")
                if s and s.string:
                    jd = json.loads(s.string)
                    canonical = jd.get("props", {}).get("pageProps", {}).get("post", {}).get("canonical_url")
                    if canonical:
                        return canonical
            except Exception:
                pass

    # Medium 系：优先 AMP
    if re.search(r"https?://(.*\.)?medium\.com/", url):
        # 尝试 /?output=amp 或 /amp 形式
        if not url.rstrip("/").endswith("/amp"):
            return url.rstrip("/") + "/amp"

    return url

def is_probable_antibot(resp_text: str, status_code: int, headers: dict) -> bool:
    if status_code in (403, 429, 503):
        return True
    lower = (resp_text or "").lower()
    signs = [
        "captcha", "cloudflare", "attention required", "just a moment",
        "access denied", "bot detection", "verify you are a human",
        "please enable javascript", "restricted access",
    ]
    return any(s in lower for s in signs)

def smart_fetch_html(url: str) -> dict:
    """
    多策略抓取：直连 → canonical/amp → 文本镜像兜底
    返回 dict: {
      ok, strategy, status, url, html, mirrored, error_type
    }
    """
    u = normalize_url(url)
    u = resolve_special(u)
    u = resolve_canonical_or_amp(u)

    # 直连抓取
    try:
        r = requests.get(u, headers=HTTP_HEADERS, timeout=UPSTREAM_TIMEOUT, allow_redirects=True)
        ct = (r.headers.get("content-type") or "").lower()
        if "text/html" in ct or "application/xhtml+xml" in ct or "<html" in r.text.lower():
            if not is_probable_antibot(r.text, r.status_code, r.headers):
                return {"ok": True, "strategy": "direct", "status": r.status_code, "url": str(r.url), "html": r.text, "mirrored": False}
            # 命中反爬
            err = {"ok": False, "strategy": "direct", "status": r.status_code, "url": str(r.url), "html": r.text, "mirrored": False, "error_type": "ANTIBOT"}
        else:
            err = {"ok": False, "strategy": "direct", "status": r.status_code, "url": str(r.url), "html": "", "mirrored": False, "error_type": "UNSUPPORTED_MIME"}
    except Exception as e:
        err = {"ok": False, "strategy": "direct", "status": 0, "url": u, "html": "", "mirrored": False, "error_type": "NETWORK_ERROR"}

    # 文本镜像兜底（可配置）
    if ALLOW_TEXT_MIRROR:
        mirror = "https://r.jina.ai/http://" + u.replace("https://", "").replace("http://", "")
        try:
            r2 = requests.get(mirror, headers=HTTP_HEADERS, timeout=UPSTREAM_TIMEOUT)
            if r2.ok and len(r2.text) > 200:  # r.jina.ai 返回已是纯文本
                return {"ok": True, "strategy": "mirror", "status": r2.status_code, "url": u, "html": r2.text, "mirrored": True}
        except Exception:
            pass

    return err

def extract_title(soup) -> str:
    # og:title / twitter:title / <title> / <h1>
    m = soup.find("meta", property="og:title") or soup.find("meta", attrs={"name":"og:title"})
    if m and m.get("content"): return m["content"].strip()
    m = soup.find("meta", attrs={"name":"twitter:title"})
    if m and m.get("content"): return m["content"].strip()
    if soup.title and soup.title.string: return soup.title.string.strip()
    h1 = soup.find("h1")
    return h1.get_text(strip=True) if h1 else ""

def extract_text_from_html(html: str, mirrored: bool=False) -> str:
    """
    先尝试 trafilatura（若安装），失败再走 Readability/BS4。
    r.jina.ai 已返回纯文本时，直接返回。
    """
    if mirrored:
        # r.jina.ai 已是纯文本
        txt = "\n".join(line for line in html.splitlines() if line.strip())
        return txt

    # trafilatura（可选依赖）
    try:
        import trafilatura
        txt = trafilatura.extract(html, include_comments=False, include_tables=False)
        if txt and len(txt) >= MIN_ARTICLE_CHARS:
            return txt.strip()
    except Exception:
        pass

    # Readability（轻量实现：提取<article>，失败则全页清洗）
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script","style","noscript","form","header","footer","aside","nav"]):
        t.decompose()
    art = soup.find("article")
    raw = (art.get_text("\n", strip=True) if art else soup.get_text("\n", strip=True))
    raw = "\n".join(line for line in raw.splitlines() if line.strip())
    return raw


# --- 全局API密钥持有者 - 这个将被废弃，但暂时保留以防其他函数依赖 ---
API_KEYS = {
    'gemini_key': None,
    'gemini_base': None,
    'siliconflow_key': None,
    'siliconflow_base': None
}

# --- 环境变量文件路径 ---
ENV_FILE = Path(__file__).parent / ".env.local"

# --- 以下基于JSON文件的路径和初始化逻辑将被注释掉 ---
# # 音色库持久化路径
# VOICES_DB_PATH = Path('voices.json')
# VOICES_AUDIO_DIR = Path('voices_audio/')

# # 历史记录存储路径
# HISTORY_DB_PATH = Path('history.json')
HISTORY_AUDIO_DIR = Path('history_audio/') # 音频文件存储目录仍然需要
PDF_STORAGE_DIR = Path('pdf_storage/') # PDF文件存储目录

# ==== 试听预览配置（新增） ====
VOICE_PREVIEW_TEXT_SINGLE = os.environ.get(
    "VOICE_PREVIEW_TEXT_SINGLE",
    "你好！这是 PodifyAI 的单人旁白试听文本。我们致力于将复杂的概念，通过精准、流畅的语言传递给每一位探索未来的听众。"
)

VOICE_PREVIEW_TEXT_ROLE = os.environ.get(
    "VOICE_PREVIEW_TEXT_ROLE",
    "[S1] 我认为，未来的内容创作将完全由人工智能主导，人类创作者只需要提出想法就够了。\n"
    "[S2] 这个观点我不太赞同。AI 确实是强大的工具，但它能真正理解并表达人类共通的情感体验吗？我认为这才是内容的核心。\n"
    "[S1] 嗯，这确实是一个值得深入探讨的点。你觉得工具和情感，应该如何才能更好地结合呢？\n"
    "[S2] 我想关键在于，让AI成为我们情感的延伸，而不是替代品。"
)

VOICE_PREVIEW_DIR = Path(os.environ.get("VOICE_PREVIEW_DIR", "voice_previews"))
VOICE_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

# --- SiliconFlow TTS config (new) ---
SF_TTS_MODEL = os.getenv("SF_TTS_MODEL", "fnlp/MOSS-TTSD-v0.5")
SF_TTS_MAX_TOKENS = int(os.getenv("SF_TTS_MAX_TOKENS", "16384"))
SF_TTS_FORMAT = os.getenv("SF_TTS_FORMAT", "wav")  # 'wav' 优先
USE_MOSS_TTSD = os.getenv("USE_MOSS_TTSD", "false").lower() == "true"  # 是否使用 MOSS-TTSD

# --- TTS 后处理策略配置 ---
TTS_TRIM_STRATEGY = os.getenv("TTS_TRIM_STRATEGY", "hybrid").lower()  # 'hybrid' | 'vad' | 'adaptive'
TTS_MAX_SCAN_MS = int(os.getenv("TTS_MAX_SCAN_MS", "12000"))  # 起点搜寻扫描窗（毫秒）
TTS_ONSET_ENERGY_DBFS = float(os.getenv("TTS_ONSET_ENERGY_DBFS", "-45"))   # 能量阈值（dBFS）
TTS_MIN_VOICE_MS      = int(os.getenv("TTS_MIN_VOICE_MS", "240"))          # 连续有声最小时长
TTS_PAD_LEADING_MS    = int(os.getenv("TTS_PAD_LEADING_MS", "60"))         # 修剪后前置静音（避免爆音）
TTS_HIGHPASS_HZ       = int(os.getenv("TTS_HIGHPASS_HZ", "60"))            # 首段高通截止频率

# --- MOSS-TTSD References 构建工具函数 ---
# 对齐 MOSS-TTSD 官方参考音频规格：16kHz 单声道，≤10s，MP3 192kbps
MOSS_REF_SAMPLE_RATE = 16000
MOSS_REF_MAX_MS = 10_000
MOSS_REF_BITRATE = "192k"

# 匹配 [S1]/[S2]/[s1]/[s2] 等任意大小写的说话人标签
_SPEAKER_TAG_RE = re.compile(r'\[\s*[sS]\s*\d+\s*\]')

def _strip_speaker_tags(text: str) -> str:
    """去除参考文本里所有的 [Sx] 标签，返回纯转录文本。"""
    if not text:
        return ""
    cleaned = _SPEAKER_TAG_RE.sub("", text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    # 去掉常见的残留前缀（冒号、全角冒号等）
    cleaned = cleaned.lstrip(':：,，。.; ').strip()
    return cleaned

def _file_to_base64_data_uri(path: Path) -> str:
    """
    读取参考音频，规格化为 MOSS-TTSD 官方推荐格式：
      - 单声道
      - 16kHz 采样率
      - 限长 10 秒（超出取前 10 秒）
      - MP3 192kbps
    返回 data URL，可直接塞进 references[].audio。
    """
    from pydub import AudioSegment

    audio = AudioSegment.from_file(path)
    audio = audio.set_channels(1).set_frame_rate(MOSS_REF_SAMPLE_RATE)
    if len(audio) > MOSS_REF_MAX_MS:
        audio = audio[:MOSS_REF_MAX_MS]

    buf = io.BytesIO()
    audio.export(buf, format="mp3", bitrate=MOSS_REF_BITRATE)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:audio/mp3;base64,{b64}"

def build_moss_references(voice_records: list) -> list:
    """
    构造 SiliconFlow MOSS-TTSD API 的 references 数组。

    voice_records: [(voice_obj, speaker_tag)]，speaker_tag 仅用于内部顺序匹配，
                   实际 references 顺序决定 [S1]/[S2] 对应关系（references[0] → [S1]，
                   references[1] → [S2]）。

    关键约定（对齐 SiliconFlow 官方示例）：
      - text 字段是纯参考转录，**不含** [S1]/[S2] 标签
      - audio 字段是 data URL（16kHz 单声道 MP3）
    """
    refs = []
    for v, _spk in voice_records:
        p = Path(v.audio_path)
        if not p.exists():
            raise FileNotFoundError(f"reference audio missing: {p}")
        data_uri = _file_to_base64_data_uri(p)
        ref_text = _strip_speaker_tags((v.text or "").strip())
        refs.append({"audio": data_uri, "text": ref_text})
    return refs

def get_voice_preview_path(voice_id: int) -> Path:
    return VOICE_PREVIEW_DIR / f"voice_{voice_id}.mp3"

def ensure_preview_file(v: Voice) -> Path:
    """
    返回可直接播放的 mp3 预览文件路径：
    - 若原文件就是 mp3：复制到预览目录，做缓存（并保持更新时间）
    - 若原文件是 wav/m4a…：转成 mp3 落预览目录，后续直接复用
    - 如果转换失败，直接返回原文件路径（让浏览器处理）
    """
    from werkzeug.exceptions import Forbidden
    
    src = Path(v.audio_path)
    dst = get_voice_preview_path(v.id)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not src.exists():
        raise FileNotFoundError(f"voice audio missing: {src}")

    # 缓存策略：源文件更新过才重建
    need_rebuild = (not dst.exists()) or (src.stat().st_mtime > dst.stat().st_mtime)

    if need_rebuild:
        if src.suffix.lower() == ".mp3":
            # 直接复制MP3文件
            shutil.copy2(src, dst)
        else:
            # 尝试转换为MP3
            try:
                AudioSegment.from_file(src).export(dst, format="mp3", bitrate="128k")
                # 检查转换是否成功
                if dst.exists() and dst.stat().st_size > 0:
                    logging.info(f"音频转换成功: {src} -> {dst}")
                else:
                    logging.warning(f"音频转换失败，文件为空: {dst}")
                    # 如果转换失败，删除空文件，直接返回原文件
                    if dst.exists():
                        dst.unlink()
                    return src
            except Exception as e:
                logging.error(f"音频转换失败: {src} -> {dst}, 错误: {e}")
                # 转换失败时，直接返回原文件路径
                return src
    
    # 检查目标文件是否有效
    if dst.exists() and dst.stat().st_size > 0:
        return dst
    else:
        # 如果目标文件无效，返回原文件
        logging.warning(f"预览文件无效，返回原文件: {src}")
        return src

# # 初始化音色库目录和文件
# if not VOICES_AUDIO_DIR.exists():
#     VOICES_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
# if not VOICES_DB_PATH.exists():
#     with open(VOICES_DB_PATH, 'w', encoding='utf-8') as f:
#         json.dump([], f, ensure_ascii=False, indent=2)

# # 初始化历史记录目录和文件
if not HISTORY_AUDIO_DIR.exists():
    HISTORY_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
if not PDF_STORAGE_DIR.exists():
    PDF_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
# if not HISTORY_DB_PATH.exists():
#     with open(HISTORY_DB_PATH, 'w', encoding='utf-8') as f:
#         json.dump([], f, ensure_ascii=False, indent=2)

# THUMBNAIL_DIR = Path('static/card-thumbnail/')
# # 扫描所有 .jpg 和 .png 文件
# if THUMBNAIL_DIR.exists():
#     THUMBNAIL_IMAGES = [f.name for f in THUMBNAIL_DIR.glob('*.jpg')] + [f.name for f in THUMBNAIL_DIR.glob('*.png')]
#     logging.info(f"发现 {len(THUMBNAIL_IMAGES)} 张可用的缩略图: {THUMBNAIL_IMAGES}")
# else:
#     THUMBNAIL_IMAGES = []
#     logging.warning(f"缩略图目录不存在: {THUMBNAIL_DIR}")
# --- 注释结束 ---


# ------------------------- 2. OTP 验证码与限流管理 -------------------------

# 内存限流计数器（简单实现，生产环境建议用 Redis）
rate_limit_store = defaultdict(lambda: defaultdict(int))

def validate_email(email):
    """验证邮箱格式"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_phone(phone):
    """验证手机号格式（支持E.164国际格式和中国大陆手机号）"""
    # E.164格式：以+开头，接6-15位数字
    e164_pattern = r'^\+[1-9]\d{6,14}$'
    # 中国大陆手机号：1[3-9] + 9位数字
    cn_pattern = r'^1[3-9]\d{9}$'
    
    return re.match(e164_pattern, phone) is not None or re.match(cn_pattern, phone) is not None

def normalize_target(target, channel):
    """
    规范化 target（邮箱或手机号）
    :param target: 原始输入
    :param channel: 'email' 或 'phone'
    :return: 规范化后的 target
    """
    if not target:
        return target
    
    if channel == 'email':
        # 邮箱小写化
        return target.strip().lower()
    elif channel == 'phone':
        # 手机号去空格
        normalized = re.sub(r'\s+', '', target.strip())
        
        # 如果已经是E.164格式（以+开头），直接返回
        if normalized.startswith('+'):
            return normalized
        
        # 去除前导0（如果有的话，但需要保持11位格式）
        if normalized.startswith('0') and len(normalized) == 12 and normalized[1:].startswith('1'):
            normalized = normalized[1:]
        
        # 如果是中国大陆手机号（1开头，11位），自动添加+86
        if normalized.startswith('1') and len(normalized) == 11:
            normalized = '+86' + normalized
        
        return normalized
    
    return target.strip()

def generate_otp_code():
    """生成6位数字验证码（保留前导0）"""
    code = secrets.randbelow(1000000)  # 0-999999
    return f"{code:06d}"  # 格式化为6位数字，不足位数前面补0

def check_rate_limit(ip, target, window_minutes=10, max_requests=3):
    """
    检查发送频率限制
    :param ip: 客户端IP
    :param target: 目标邮箱/手机号
    :param window_minutes: 时间窗口（分钟）
    :param max_requests: 最大请求数
    :return: (is_allowed, remaining_count)
    """
    now = datetime.datetime.utcnow()
    window_start = now - datetime.timedelta(minutes=window_minutes)
    
    # 检查目标限流
    target_count = OTPCode.query.filter(
        OTPCode.target == target,
        OTPCode.created_at >= window_start
    ).count()
    
    # 检查IP限流（每IP每10分钟最多15次请求）
    ip_count = OTPCode.query.filter(
        OTPCode.ip == ip,
        OTPCode.created_at >= window_start
    ).count()
    
    target_allowed = target_count < max_requests
    ip_allowed = ip_count < 15  # IP总量限制
    
    return target_allowed and ip_allowed, max_requests - target_count

def create_otp_code(target, channel, purpose='login', ip=None, expires_minutes=10):
    """
    创建OTP验证码
    :param target: 邮箱或手机号
    :param channel: 'email' 或 'phone'
    :param purpose: 'register' 或 'login'
    :param ip: 客户端IP
    :param expires_minutes: 过期时间（分钟）
    :return: OTPCode对象或None
    """
    # 检查限流
    is_allowed, remaining = check_rate_limit(ip, target)
    if not is_allowed:
        logging.warning(f"OTP请求被限流: {target} from {ip}")
        return None
    
    # 清理该目标的旧验证码
    old_codes = OTPCode.query.filter_by(target=target, purpose=purpose).all()
    for old_code in old_codes:
        db.session.delete(old_code)
    
    # 生成新验证码
    code = generate_otp_code()
    expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=expires_minutes)
    
    otp_code = OTPCode(
        target=target,
        channel=channel,
        code=code,
        purpose=purpose,
        expires_at=expires_at,
        ip=ip
    )
    
    db.session.add(otp_code)
    db.session.commit()
    
    logging.info(f"OTP码已生成: {target[:3]}***{target[-3:]} ({channel}) - {code}")
    return otp_code

def verify_otp_code(target, input_code, purpose='login'):
    """
    验证OTP验证码
    :param target: 邮箱或手机号
    :param input_code: 用户输入的验证码
    :param purpose: 'register' 或 'login'
    :return: (success, message, otp_code)
    """
    otp_code = OTPCode.query.filter_by(
        target=target, 
        purpose=purpose
    ).order_by(OTPCode.created_at.desc()).first()
    
    if not otp_code:
        return False, "验证码不存在或已过期", None
    
    if otp_code.is_expired():
        return False, "验证码已过期", otp_code
    
    if otp_code.is_attempts_exceeded():
        return False, "验证码尝试次数过多，请重新获取", otp_code
    
    if not otp_code.verify_code(input_code):
        otp_code.increment_attempts()
        remaining_attempts = 5 - otp_code.attempts
        return False, f"验证码错误，还有{remaining_attempts}次机会", otp_code
    
    # 验证成功，删除验证码
    db.session.delete(otp_code)
    db.session.commit()
    
    return True, "验证成功", otp_code

def send_email_via_sendgrid(to_email: str, subject: str, text: str, html: str = None) -> bool:
    """通过 SendGrid API 发送邮件"""
    if not SENDGRID_API_KEY or not SENDGRID_FROM:
        logging.error("SendGrid 配置不完整（API_KEY/From），无法发送邮件。")
        return False

    payload = {
        "personalizations": [{
            "to": [{"email": to_email}],
        }],
        "from": {"email": SENDGRID_FROM, "name": SENDGRID_FROM_NAME},
        "subject": subject,
        "content": [{"type": "text/plain", "value": text}]
    }
    if html:
        payload["content"].append({"type": "text/html", "value": html})

    if SENDGRID_SANDBOX:
        payload.setdefault("mail_settings", {})["sandbox_mode"] = {"enable": True}

    headers = {
        "Authorization": f"Bearer {SENDGRID_API_KEY}",
        "Content-Type": "application/json"
    }

    try:
        resp = requests.post("https://api.sendgrid.com/v3/mail/send",
                             headers=headers, data=json.dumps(payload), timeout=15)
        # SendGrid: 202 = Accepted（异步投递），其余为错误
        if resp.status_code == 202:
            logging.info(f"SendGrid 已接受邮件发送：to={to_email}")
            return True
        else:
            # 常见 4xx：来自未验证 From、收件人被拒、API 权限问题
            logging.error(f"SendGrid 发送失败：HTTP {resp.status_code} - {resp.text.strip()}")
            return False
    except requests.RequestException as e:
        logging.error(f"SendGrid 请求异常：{e}")
        return False

def send_otp_email(email, code, purpose='login'):
    """发送OTP验证码邮件"""
    purpose_text_map = {
        'register': '注册',
        'login': '登录',
        'bind': '绑定邮箱'
    }
    purpose_text = purpose_text_map.get(purpose, purpose)
    subject = f"[PodifyAI] {purpose_text}验证码"
    text = f"您的{purpose_text}验证码是：{code}\n10分钟内有效。若非本人操作，请忽略。"
    html = f"<p>您的<b>{purpose_text}</b>验证码是：<b>{code}</b></p><p>10分钟内有效。</p>"

    # 开发模式：只打印，不发送
    if OTP_DEV_LOG_ONLY:
        logging.info(f"开发模式 - 模拟发送邮件到 {email}: 您的{purpose_text}验证码是 {code}，10分钟内有效。")
        return True

    # 生产：优先 SendGrid
    if EMAIL_PROVIDER == "sendgrid":
        ok = send_email_via_sendgrid(email, subject, text, html)
        if ok:
            return True
        else:
            logging.warning(f"SendGrid 发送失败，尝试回退到 SMTP")

    # 回退 SMTP（原逻辑保留）
    try:
        # 检查必要的SMTP配置
        if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]):
            logging.error("SMTP配置不完整，无法发送邮件")
            return False
        
        # 构造邮件内容
        subject = f"PodifyAI 验证码 - {purpose_text}"
        body = f"""您的验证码是：{code}

此验证码将在10分钟后过期，请及时使用。

如果您没有请求此验证码，请忽略此邮件。

---
PodifyAI 团队"""
        
        # 创建邮件对象
        msg = MIMEMultipart()
        msg['From'] = EMAIL_FROM
        msg['To'] = email
        msg['Subject'] = subject
        
        # 添加邮件正文
        msg.attach(MIMEText(body, 'plain', 'utf-8'))
        
        # 连接SMTP服务器
        if SMTP_USE_TLS:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT)
        
        # 登录
        server.login(SMTP_USER, SMTP_PASS)
        
        # 发送邮件
        server.send_message(msg)
        server.quit()
        
        logging.info(f"成功发送验证码邮件到 {email}")
        return True
        
    except Exception as e:
        logging.error(f"发送邮件失败 {email}: {e}")
        return False

def send_otp_sms(phone, code, purpose='login'):
    """发送OTP验证码短信"""
    if OTP_DEV_LOG_ONLY:
        # 开发模式：仅输出日志
        purpose_text = "注册" if purpose == 'register' else "登录"
        logging.info(f"开发模式 - 模拟发送短信到 {phone}: 您的{purpose_text}验证码是 {code}，10分钟内有效。")
        return True
    
    # 生产模式：真实发送短信
    try:
        # 优先使用 Twilio
        if all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER]):
            return send_otp_sms_twilio(phone, code, purpose)
        
        # 如果以后切国内云短信，在这里预留分支
        # TODO: 实现阿里云短信服务
        # if all([ALIYUN_ACCESS_KEY_ID, ALIYUN_ACCESS_KEY_SECRET]):
        #     return send_otp_sms_aliyun(phone, code, purpose)
        
        # TODO: 实现腾讯云短信服务
        # if all([TENCENT_SECRET_ID, TENCENT_SECRET_KEY]):
        #     return send_otp_sms_tencent(phone, code, purpose)
        
        logging.error("短信服务配置不完整，无法发送短信")
        return False
        
    except Exception as e:
        logging.error(f"发送短信失败 {phone}: {e}")
        return False

def send_otp_sms_twilio(phone, code, purpose='login'):
    """使用 Twilio 发送短信"""
    try:
        # 这里需要安装 twilio 库：pip install twilio
        # 暂时用 try-except 处理，避免依赖问题
        try:
            from twilio.rest import Client
        except ImportError:
            logging.error("Twilio 库未安装，请运行: pip install twilio")
            return False
        
        # 确保手机号是 E.164 格式
        if not phone.startswith('+'):
            logging.error(f"手机号 {phone} 不是 E.164 格式")
            return False
        
        # 初始化 Twilio 客户端
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        
        # 构造短信内容
        purpose_text = "注册" if purpose == 'register' else "登录"
        message_body = f"您的{purpose_text}验证码是：{code}，10分钟内有效。"
        
        # 发送短信
        message = client.messages.create(
            body=message_body,
            from_=TWILIO_FROM_NUMBER,
            to=phone
        )
        
        logging.info(f"成功发送 Twilio 短信到 {phone}, SID: {message.sid}")
        return True
        
    except Exception as e:
        logging.error(f"Twilio 短信发送失败 {phone}: {e}")
        return False

def send_otp_code(target, channel, purpose='login', ip=None):
    """
    发送OTP验证码的统一接口
    :param target: 邮箱或手机号
    :param channel: 'email' 或 'phone'
    :param purpose: 'register' 或 'login'
    :param ip: 客户端IP
    :return: (success, message)
    """
    # 验证格式
    if channel == 'email' and not validate_email(target):
        return False, "邮箱格式不正确"
    elif channel == 'phone' and not validate_phone(target):
        return False, "手机号格式不正确"
    
    # 创建验证码
    otp_code = create_otp_code(target, channel, purpose, ip)
    if not otp_code:
        return False, "发送过于频繁，请稍后再试"
    
    # 发送验证码
    try:
        if channel == 'email':
            success = send_otp_email(target, otp_code.code, purpose)
        else:
            success = send_otp_sms(target, otp_code.code, purpose)
        
        if success:
            return True, "验证码已发送"
        else:
            # 发送失败，删除验证码记录
            db.session.delete(otp_code)
            db.session.commit()
            return False, "验证码发送失败，请稍后重试"
    except Exception as e:
        logging.error(f"发送验证码失败: {e}")
        return False, "验证码发送失败，请稍后重试"

# ------------------------- 3. 密钥管理函数 -------------------------

def load_keys_on_startup():
    """启动时从环境变量和.env.local文件加载API密钥和Base URL"""
    try:
        # 从环境变量读取密钥和Base URL
        gemini_key = os.getenv("OPENAI_API_KEY")
        gemini_base = os.getenv("OPENAI_API_BASE")
        siliconflow_key = os.getenv("SILICONFLOW_API_KEY")
        siliconflow_base = os.getenv("SILICONFLOW_API_BASE")
        
        # 更新全局密钥字典
        if gemini_key:
            API_KEYS['gemini_key'] = gemini_key
            logging.info("已从环境变量加载 Gemini API Key")
        else:
            logging.warning("环境变量 OPENAI_API_KEY 未设置")
            
        if gemini_base:
            API_KEYS['gemini_base'] = gemini_base
            logging.info("已从环境变量加载 Gemini API Base")
        else:
            logging.info("环境变量 OPENAI_API_BASE 未设置，将使用默认值")
            
        if siliconflow_key:
            API_KEYS['siliconflow_key'] = siliconflow_key
            logging.info("已从环境变量加载 SiliconFlow API Key")
        else:
            logging.warning("环境变量 SILICONFLOW_API_KEY 未设置")
            
        if siliconflow_base:
            API_KEYS['siliconflow_base'] = siliconflow_base
            logging.info("已从环境变量加载 SiliconFlow API Base")
        else:
            logging.info("环境变量 SILICONFLOW_API_BASE 未设置，将使用默认值")
            
        # 尝试从 .env.local 文件加载密钥和Base URL
        if ENV_FILE.exists():
            logging.info(f"正在从 {ENV_FILE} 加载环境变量...")
            with open(ENV_FILE, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        key = key.strip()
                        value = value.strip()
                        
                        if key == "OPENAI_API_KEY" and not API_KEYS['gemini_key']:
                            API_KEYS['gemini_key'] = value
                            logging.info("已从 .env.local 加载 Gemini API Key")
                        elif key == "OPENAI_API_BASE" and not API_KEYS['gemini_base']:
                            API_KEYS['gemini_base'] = value
                            logging.info("已从 .env.local 加载 Gemini API Base")
                        elif key == "SILICONFLOW_API_KEY" and not API_KEYS['siliconflow_key']:
                            API_KEYS['siliconflow_key'] = value
                            logging.info("已从 .env.local 加载 SiliconFlow API Key")
                        elif key == "SILICONFLOW_API_BASE" and not API_KEYS['siliconflow_base']:
                            API_KEYS['siliconflow_base'] = value
                            logging.info("已从 .env.local 加载 SiliconFlow API Base")
                            
        # 设置默认值（如果未设置）
        if not API_KEYS['gemini_base']:
            API_KEYS['gemini_base'] = "https://generativelanguage.googleapis.com/v1beta/openai/"
            logging.info("使用默认 Gemini API Base")
            
        if not API_KEYS['siliconflow_base']:
            API_KEYS['siliconflow_base'] = "https://api.siliconflow.cn/v1"
            logging.info("使用默认 SiliconFlow API Base")
                            
    except Exception as e:
        logging.error(f"加载API密钥和Base URL时出错: {e}")

def save_keys_to_env_file(gemini_key, siliconflow_key, gemini_base, siliconflow_base):
    """将API密钥和Base URL保存到.env.local文件"""
    try:
        # 读取现有文件内容
        existing_lines = []
        if ENV_FILE.exists():
            with open(ENV_FILE, 'r', encoding='utf-8') as f:
                existing_lines = f.readlines()
        
        # 准备新的密钥行
        new_lines = []
        gemini_key_updated = False
        siliconflow_key_updated = False
        gemini_base_updated = False
        siliconflow_base_updated = False
        
        # 处理现有行，更新或保留
        for line in existing_lines:
            line = line.strip()
            if line.startswith('OPENAI_API_KEY='):
                new_lines.append(f'OPENAI_API_KEY={gemini_key}\n')
                gemini_key_updated = True
            elif line.startswith('SILICONFLOW_API_KEY='):
                new_lines.append(f'SILICONFLOW_API_KEY={siliconflow_key}\n')
                siliconflow_key_updated = True
            elif line.startswith('OPENAI_API_BASE='):
                new_lines.append(f'OPENAI_API_BASE={gemini_base}\n')
                gemini_base_updated = True
            elif line.startswith('SILICONFLOW_API_BASE='):
                new_lines.append(f'SILICONFLOW_API_BASE={siliconflow_base}\n')
                siliconflow_base_updated = True
            elif line and not line.startswith('#'):
                new_lines.append(line + '\n')
        
        # 添加缺失的密钥行
        if not gemini_key_updated:
            new_lines.append(f'OPENAI_API_KEY={gemini_key}\n')
        if not siliconflow_key_updated:
            new_lines.append(f'SILICONFLOW_API_KEY={siliconflow_key}\n')
        if not gemini_base_updated and gemini_base:
            new_lines.append(f'OPENAI_API_BASE={gemini_base}\n')
        if not siliconflow_base_updated and siliconflow_base:
            new_lines.append(f'SILICONFLOW_API_BASE={siliconflow_base}\n')
        
        # 写入文件
        with open(ENV_FILE, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)
            
        logging.info("API密钥和Base URL已成功保存到 .env.local 文件")
        return True
        
    except Exception as e:
        logging.error(f"保存API密钥和Base URL到文件时出错: {e}")
        return False

# --- API Client 获取函数（重构版） ---
def get_gemini_client():
    """获取 Gemini (OpenAI 兼容模式) 的客户端"""
    api_key = API_KEYS.get('gemini_key')
    api_base = API_KEYS.get('gemini_base')
    
    if not api_key:
        raise ValueError("Gemini API Key 未设置，请先在设置中配置")
    
    return OpenAI(
        api_key=api_key,
        base_url=api_base
    )

def get_siliconflow_client():
    """获取 SiliconFlow 的客户端"""
    api_key = API_KEYS.get('siliconflow_key')
    api_base = API_KEYS.get('siliconflow_base')
    
    if not api_key:
        raise ValueError("SiliconFlow API Key 未设置，请先在设置中配置")
    
    return OpenAI(
        api_key=api_key,
        base_url=api_base
    )

# ------------------------- 3. 核心功能函数 -------------------------

def generate_title_with_gemini(content: str, gemini_model: str = "gemini-2.5-flash"):
    """仅使用 Gemini API 为给定内容生成一个标题"""
    client = get_gemini_client()
    prompt = f"请为以下播客脚本内容提炼一个15字以内的、引人入胜的短标题。只输出标题本身，不要包含任何多余的词语或符号，例如【标题】。\n\n【脚本内容】:\n{content[:1500]}" # 截取前1500字以提高效率和节省成本
    
    logging.info(f"正在调用 Gemini API (模型: {gemini_model}) 生成标题...")
    completion = client.chat.completions.create(
        model=gemini_model,
        messages=[
            {"role": "user", "content": prompt}
        ],
        temperature=0.7
    )
    title = completion.choices[0].message.content.strip()
    logging.info(f"标题生成成功: '{title}'")
    return title

def create_podcast_script_with_gemini(content: str, mode: str, gemini_model: str, style_key: str = None, length_mode: str = 'concise'):
    """使用 Gemini API 和高级提示词模板生成播客脚本"""
    client = get_gemini_client()

    # --- 新的提示词模板 ---
    DUO_TEMPLATE = """🎯 【PodifyAI播客脚本生成器 - 双人对话版】

📌 输出格式要求：
【标题】：[15字以内的吸睛标题]
---
[脚本正文]

🎪 核心使命：将素材转化为一场"思维碰撞秀"

🎭 角色人设：
- [S1] "知识探索者"：充满好奇心的分享者，善于发现有趣角度，语言生动有画面感
- [S2] "理性质疑者"：代表听众的批判性思维，敢于提出尖锐问题，推动对话深入

🎨 PodifyAI独家风格标签：
✓ "5秒抓取法则"：开场5秒内必须抛出一个让人无法忽视的hook
✓ "三段式震撼"：Setup(设置悬念) → Conflict(制造冲突) → Payoff(给出答案)
✓ "对话炸弹"：每隔30秒投放一个"没想到吧"的反转或新发现
✓ "共鸣桥梁"：频繁使用"你有没有过这样的经历..."建立听众连接

📏 智能时长控制：
- 自适应原则：根据素材信息密度智能调节脚本长度
  - 轻量内容(1-2个核心点)：3-5分钟 (900-1500字)
  - 中等内容(3-5个核心点)：6-10分钟 (1800-3000字)  
  - 丰富内容(6+个核心点)：11-20分钟 (3300-6000字)
- 质量优先：宁可稍长也不遗漏重要信息，确保每个有价值的观点都得到充分展现
- 节奏：S1长句阐述 ↔ S2短句追问，形成"教授+学生"的自然互动
- 禁忌：杜绝一切舞台提示(括号内容)，不得出现任何 Markdown 标记，保持纯对话流，请在输出前自我修正为纯文本。最终只输出脚本内容。

输出要求与规则:
- 必须的格式: 每一行以 [S1] 或 [S2] 开头，紧跟空格与台词。
例如：
[S1]诶，跟你说个事儿啊，我最近听了不少那种AI生成的播客，不知道你有没有听过。
[S2]哦，听过一些。怎么了，感觉怎么样？
[S1]就是……怎么说呢，单听一句话，你觉得，哇，好像跟真人没啥区别。
[S2]嗯。
[S1]但是，你只要让它说上一段完整的对话，比如俩人聊天那种，那个感觉就立马不对了。
[S2]对对对，我懂你的意思。就是那个所谓的“恐怖谷”效应，是吧？听着有点瘆人，感觉特别假，没有那个交流感。
- 内容来源: 严格基于【素材正文】，不允许虚构。

🔥 剧本密码：
1️⃣ 开场必杀技：
   S1抛出反常识观点 → S2表达震惊 → S1预告"更劲爆的在后面"
   
2️⃣ 中段推进器：
   - 每个知识点包装成"小故事"
   - S2适时打断："等等，这听起来..."
   - 用"举个例子"、"换句话说"保持节奏
   
3️⃣ 收尾放大招：
   内容总结 → 要点提炼 → 思考启发
   
🎯 结尾三部曲：
   a) 核心回顾：S1和S2共同梳理关键收获
   b) 要点清单：列出3-5个核心takeaway(用"第一...第二...第三"的方式)
   c) 思考作业：抛出1-2个延伸思考问题，让听众带着好奇心离开

💎 质量保证线：
严格基于【素材正文】，零虚构，但要善用"换个角度看"的包装技巧

【素材正文】
{source}"""

    SOLO_TEMPLATE = """🎯 【PodifyAI播客脚本生成器 - 单人口播版】

📌 输出格式要求：
【标题】：[15字以内的吸睛标题]
---
[脚本正文]

🎪 核心使命：打造"一个人的脱口秀"，让听众感觉你就坐在他面前聊天

🎭 主播人设：
"邻家智者"：既有深度见解，又接地气；既严谨可信，又风趣幽默

🎨 PodifyAI独家风格标签：
✓ "破冰三连击"：反问句+惊人数据+个人化场景，瞬间拉近距离
✓ "悬念编织术"：埋伏笔→制造疑问→适时解答，让人欲罢不能
✓ "共情共鸣术"：大量使用"你可能也遇到过..."建立情感连接
✓ "故事套故事"：用小故事包装大道理，让抽象概念变得具体

📏 智能时长控制：
- 自适应原则：根据素材信息密度智能调节脚本长度
  - 轻量内容(1-2个核心点)：3-5分钟 (900-1500字)
  - 中等内容(3-5个核心点)：6-10分钟 (1800-3000字)
  - 丰富内容(6+个核心点)：11-20分钟 (3300-6000字)
- 质量优先：宁可稍长也不遗漏重要信息，确保每个有价值的观点都得到充分展现
- 结构：钩子开头(10%) + 核心内容(70%) + 总结收尾(20%)
- 禁忌：杜绝朗读腔调，杜绝一切舞台提示(括号内容)，不得出现任何 Markdown 标记，保持纯对话流，请在输出前自我修正为纯文本。最终只输出脚本内容。

🔥 独白密码：
🚀 开场爆款公式：
"我先问你个问题..." + "数据/现象" + "你想过为什么吗？"

🎬 内容编织术：
1️⃣ 分块呈现：每个知识点控制在150字内
2️⃣ 转场神句："但这还不是最有趣的..."
3️⃣ 互动感营造：
   - "我猜你现在在想..."
   - "别急，答案马上就来..."
   - "这就好比..."(巧用比喻)

🎯 结尾必杀技：
内容总结 → 要点清单 → 思考启发

📋 收尾三步走：
1️⃣ 核心回顾：简明总结今天分享的主要内容
2️⃣ 要点清单：提炼3-5个关键takeaway，用"首先...其次...最后"逐一呈现  
3️⃣ 思考作业：抛出1-2个延伸问题，让听众带着好奇心和行动力离开

💡 段落呼吸：
每段空行分隔，形成自然的语音停顿节点

💎 质量保证线：
严格基于【素材正文】，但要善用"生活化翻译"让专业内容变得亲民

【素材正文】
{source}"""
    
    # --- 风格和长度补丁映射 ---
    ROLE_STYLE_PATCH = {
        # 1) 嘉宾访谈
        "interview": """【风格补丁｜嘉宾访谈】
角色分工：S1=主持人（提问/追问/收束），S2=嘉宾（经验/案例/方法）。
结构段落：冷启动15秒（嘉宾标签+这期价值）→ 背景铺垫 → 三轮深问（每轮"问题→细化追问→一个具体故事/数据"）→ 快问快答（3题，节奏快）→ 总结要点（3-5条）。
说话方式：S1问题短而尖锐；S2回答具体、有画面，有时间/金额/结果等量化信息。
强制约束：避免空话；每个故事都要有起因-行动-结果（PAR）；不出现舞台指令。
输出严格为纯对话行（[S1]/[S2] 开头）。""",

        # 2) 双人漫谈
        "banter": """【风格补丁｜双人漫谈】
人设：S1=理性吐槽；S2=感性捧哏&补刀。
结构节拍：轻松开场梗→ 三个小话题（各含"一个点子+一个小例子+回扣开场的call-back"）→ 生活落点（给听众可操作的小建议1-2条）。
节奏与语气：句子偏短；1-3句完成一个回合；适度互损但不说教；多用"你有没有这种时刻…"建立陪伴感。
强制约束：不灌鸡汤，不给宏大结论；保持对话来回，拒绝长段独白。""",

        # 3) 观点碰撞
        "debate": """【风格补丁｜观点碰撞】
立场：S1=立场A，S2=立场B（互补或对立，须在开场即清晰声明）。
结构：立场陈述（各≤3句）→ 交叉质询（"因为/所以/例如"完成论证）→ 局部让步与反驳（指出前提差异）→ 共识与分歧清单 → 听众思考题（1-2个）。
语气：克制、礼貌、逻辑清晰；每个重要观点至少配一个实例或数据。
强制约束：杜绝人身攻击与稻草人论证；保持回合制，不出现长段独白。"""
    }
    SINGLE_STYLE_PATCH = {
        # 1) 个人独白/观点分享
        "monologue": """【风格补丁｜个人独白】
主线：问题→洞见→方法→风险点→行动建议。
语气：第二人称（直接对听众说话），兼具温度与锋利；至少给出3句"金句式"表达（≤20字/句）。
呈现：每段≤150字，段间留空行形成停顿；用生活化比喻解释抽象概念。
强制约束：不堆砌引用与名词，不出现舞台指令。""",

        # 2) 知识科普
        "edu": """【风格补丁｜知识科普】
讲解路径：提出概念→准确定义→类比解释→小例题/案例→常见误区→复盘要点。
写作手势：分块编号（1/2/3…），每块先给结论再解释；给一个记忆口诀或"如果只记一个点"。
强制约束：术语出现即解释；不空谈"意义"，以具体现象/数值说话。""",

        # 3) 叙事/故事讲述
        "narrative": """【风格补丁｜叙事讲述】
结构：场景引入→冲突升级→高潮/转折→尾声/余韵（带一个含义提炼）。
讲述要求：开头两句必须是画面（时间/地点/人物/动作），贯穿少量感官细节；以短句推动节奏；对话不超过两人同时出现。
强制约束：不出现旁白式舞台提示；角色/地点数量克制（一次引入≤4个）。"""
    }
    LENGTH_PATCH = {
        "concise": "【长度策略｜精简模式】先做信息抽取与重组，只保留对理解/剧情推进必需的要点；合并同类项，删除重复与冗余铺垫；结尾给3条最可行的Takeaway。",
        "detailed": "【长度策略｜详尽模式】尽量保留素材中的细节与结构，完整覆盖论据/反例/背景脉络；在不改变事实的前提下优化表达与衔接。"
    }

    style_patch = (ROLE_STYLE_PATCH if mode == 'role' else SINGLE_STYLE_PATCH).get(style_key or '', '')
    length_patch = LENGTH_PATCH.get(length_mode or 'concise', LENGTH_PATCH['concise'])
    
    # --- 逻辑实现 ---
    if mode == 'role':
        prompt = DUO_TEMPLATE.format(source=content)
    else: 
        prompt = SOLO_TEMPLATE.format(source=content)

    # 在主模板后追加补丁
    if style_patch:
        prompt += "\n\n" + style_patch
    if length_patch:
        prompt += "\n\n" + length_patch

    logging.info(f"正在调用 Gemini API (模型: {gemini_model}) 生成脚本...")
    completion = client.chat.completions.create(
        model=gemini_model,
        messages=[
            {"role": "system", "content": "你只能基于提供的【原文正文】生成播客脚本；不得引入外部知识；若信息不足请直接说明并退出。"},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7
    )
    # --- 新增的健壮性检查 ---
    response_content = completion.choices[0].message.content
    if not response_content:
        # 记录 finish_reason 以便调试
        finish_reason = getattr(completion.choices[0], 'finish_reason', None)
        logging.warning(f"Gemini API 返回了空内容。Finish Reason: {finish_reason}")
        raise ValueError("从 Gemini API 收到的脚本内容为空，可能触发了安全过滤器或内容为空。请尝试更换链接或文本。")

    raw_output = response_content.strip()
    title = "无标题播客"
    script = raw_output # 默认脚本为全部内容

    if "---" in raw_output:
        parts = raw_output.split("---", 1)
        header = parts[0]
        script_body = parts[1].strip()
        
        # 尝试从头部提取标题
        if "【标题】：" in header:
            title = header.split("【标题】：" , 1)[1].strip()
        
        script = script_body

    logging.info(f"脚本生成成功 - 标题: '{title}', 脚本长度: {len(script)}.")
    return title, script # 返回一个包含标题和脚本的元组

def audio_to_data_uri(file_path: Path) -> str:
    """将音频文件转换为 Base64 Data URI"""
    mime_types = {'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.opus': 'audio/opus'}
    ext = file_path.suffix.lower()
    mime = mime_types.get(ext, 'application/octet-stream')
    
    with open(file_path, 'rb') as f:
        binary_data = f.read()
    
    base64_data = base64.b64encode(binary_data).decode('utf-8')
    return f"data:{mime};base64,{base64_data}"

# --- Audio post-processing utils for previews ---
import io
import re
from pydub import AudioSegment, effects
from pydub.silence import detect_nonsilent

# ====== 文本清洗 & 引用构建 & 语言判断 ======
CHN_RE = re.compile(r'[\u4e00-\u9fff]')

def has_chinese(s: str) -> bool:
    """检测文本是否包含中文字符"""
    return bool(CHN_RE.search(s or ''))

def sanitize_single_text(txt: str) -> str:
    """单人模式：去掉 [S1]/[S2] 标签，避免模型把标签读出来影响语言判断"""
    return re.sub(r'\[(?:S1|S2)\]\s*', '', txt or '').strip()

def ensure_single_tagging(txt: str) -> str:
    """单人模式：保证每行都带 [S1] 前缀（若已有则规范化，不存在则补上）"""
    t = (txt or "").replace("\r\n", "\n").strip()
    if not t:
        return t
    
    # S1：单人文本强制加标签 - 如果整个文本没有以[S1]开头，就强制添加
    if not t.startswith('[S1]'):
        t = '[S1]' + ('' if t.startswith('\n') else ' ') + t
    
    # 规范已有标签为标准形态
    t = _normalize_dialogue_tags(t)
    lines = []
    has_any_s1 = False
    for line in t.split("\n"):
        s = line.strip()
        if not s:
            lines.append("")
            continue
        if s.startswith("[S1]"):
            has_any_s1 = True
            lines.append(s)
        elif s.startswith("[S2]"):
            # 单人模式不应出现 S2，统一改为 S1
            s = "[S1]" + s[len("[S2]"):]
            has_any_s1 = True
            lines.append(s)
        else:
            lines.append(f"[S1] {s}")
            has_any_s1 = True
    return "\n".join(lines)

# 已弃用：trim_leading_noise_wav 函数已被 finalize_tts_output 替代
# 保留此函数以备将来需要，但不再使用以避免重复处理
def trim_leading_noise_wav(wav_path_in, wav_path_out, sr=16000, vad_aggr=2):
    """
    5.3 产物治理：对合成产物做"首音裁切 + 5ms 淡入"
    返回首音到达时间（毫秒）
    
    注意：此函数已被 finalize_tts_output 替代，不再使用以避免重复处理
    """
    if not _HAS_VAD:
        logging.warning("webrtcvad not available, skipping leading noise trimming")
        # 简单复制文件
        shutil.copy2(wav_path_in, wav_path_out)
        return 0  # 无法检测时返回0
    
    try:
        import webrtcvad
        import soundfile as sf
        import numpy as np
        
        # 读取音频
        audio, file_sr = sf.read(wav_path_in)
        if file_sr != sr:
            audio = librosa.resample(audio, orig_sr=file_sr, target_sr=sr)
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)

        # VAD: 30ms 帧
        vad = webrtcvad.Vad(vad_aggr)
        frame_len = int(sr * 0.03)
        hop = frame_len
        voiced = []
        for i in range(0, len(audio) - frame_len, hop):
            frame = (audio[i:i+frame_len] * 32768).astype(np.int16).tobytes()
            voiced.append(1 if vad.is_speech(frame, sr) else 0)

        # 找"首个≥300ms 连通有声段"的起点
        need_frames = int(0.30 / 0.03)  # 10 帧
        start_f = 0
        run = 0
        speech_onset_frame = 0
        for idx, v in enumerate(voiced):
            run = run + 1 if v else 0
            if run >= need_frames:
                start_f = idx - need_frames + 1
                speech_onset_frame = start_f
                break

        # 计算首音到达时间（毫秒）
        speech_onset_ms = int(speech_onset_frame * hop * 1000 / sr)

        # 保护带 100ms
        protect = int(sr * 0.10)
        start = max(0, start_f * hop - protect)

        trimmed = audio[start:]

        # 5ms 线性淡入
        fade = int(sr * 0.005)
        if len(trimmed) > fade:
            ramp = np.linspace(0, 1, fade)
            trimmed[:fade] *= ramp

        sf.write(wav_path_out, trimmed, sr, subtype='PCM_16')
        
        return speech_onset_ms
        
    except Exception as e:
        logging.error(f"Leading noise trimming failed: {e}")
        # 失败时简单复制文件
        shutil.copy2(wav_path_in, wav_path_out)
        return 0

def sanitize_single_text(text: str) -> str:
    """
    净化单人模式文本：去掉所有 [S1]/[S2] 标签和提示符号
    用于 voice_uri 模式，让模型在纯文本域启动
    """
    if not text:
        return ""
    
    # 去掉所有说话人标签
    import re
    clean_text = re.sub(r'\[S\d+\]\s*', '', text)
    
    # 去掉提示符号和多余空格
    clean_text = re.sub(r'^[：:.\-、\s]+', '', clean_text)
    clean_text = re.sub(r'[：:.\-、\s]+$', '', clean_text)
    
    # 清理多余的空行和空格
    clean_text = re.sub(r'\n\s*\n', '\n', clean_text)
    clean_text = re.sub(r' +', ' ', clean_text)
    
    return clean_text.strip()

def _sanitize_reference_text_for_single(txt: str) -> str:
    """把参考文本净化成单说话人：去掉任何 [Sx]、冒号等提示，仅保留内容"""
    if not txt:
        return ""
    t = txt.replace("\r\n", "\n").strip()
    # 先把各种非标准标签正规化为 [S1]/[S2]
    t = _normalize_dialogue_tags(t)
    # **关键**：单人模式禁止出现 S2/S3…，直接删除所有说话人标签
    t = re.sub(r'\s*\[S\d+\]\s*', ' ', t)
    # 去掉可能的提示性符号（：：- 等）
    t = re.sub(r'^[：:.\-、\s]+', '', t)
    # 折叠多空白，限制长度（1~2 句足够）
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def _autofix_single_voice_text(text: str) -> str:
    """发现对话痕迹就净化"""
    if re.search(r'\[?\s*S\s*2\s*\]?', text, flags=re.I):
        return _sanitize_reference_text_for_single(text)
    return text

def build_sf_references(voice_names: dict, mode: str = 'single') -> list:
    """
    依据 DB 里的 Voice 记录构建 SiliconFlow 的 references 数组
    严格对齐 MOSS-TTSD 规范：single 也要 [S1]，role 则 [S1]/[S2]
    voice_names: {'s1': '中文音色名', 's2': None}
    mode: 'single' 或 'role'
    """
    def _clean_s_prefix(t: str) -> str:
        """清洗文本中的 [S1]/[S2] 前缀，避免双重标签"""
        return re.sub(r'^\s*\[S[12]\]\s*', '', (t or '').strip())

    refs = []
    
    # single 也要加 [S1]，role 则 [S1]/[S2]
    plan = [('s1', '[S1]')] if not (mode == 'role' and voice_names.get('s1') and voice_names.get('s2')) \
           else [('s1','[S1]'), ('s2','[S2]')]

    for key, tag in plan:
        name = (voice_names or {}).get(key)
        if not name:
            continue
        
        # 关键：限定"当前用户的音色 OR 全站共享"
        v = Voice.query.filter(
            Voice.name == name
        ).filter(
            or_(Voice.is_global == True, Voice.user_id == current_user.id)
        ).order_by(Voice.is_global.desc()).first()
        
        if not v:
            raise ValueError(f'找不到音色：{name}（请检查是否归属当前用户或为全站共享）')

        p = Path(v.audio_path)
        if not p.exists():
            raise FileNotFoundError(f'音色参考音频不存在：{p}')

        b64 = base64.b64encode(p.read_bytes()).decode('utf-8')
        mime = {
            '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
            '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
            '.webm': 'audio/webm', '.aac': 'audio/aac'
        }.get(p.suffix.lower(), 'application/octet-stream')

        base_text = (v.text or "").strip()
        if mode != 'role':
            # 单人模式：把参考文本净化为"无标签的单说话人文本"，再统一加 [S1]
            safe_text = _sanitize_reference_text_for_single(base_text) or VOICE_PREVIEW_TEXT_SINGLE
            ref_text = f'{tag} {safe_text}'.strip()
        else:
            # 对话模式：只把**开头**的冗余标签清洗一次，保留用户标注
            base_text = _clean_s_prefix(base_text) or VOICE_PREVIEW_TEXT_ROLE
            ref_text = f'{tag} {base_text}'.strip()

        refs.append({
            "audio": f"data:{mime};base64,{b64}",
            "text":  ref_text
        })

    if not refs:
        raise ValueError('未提供有效的参考音色，请先选择音色后再合成')
    return refs

def convert_and_fade(raw_bytes: bytes, in_fmt: str = "wav", out_fmt: str = "mp3", fade_ms: int = 20) -> bytes:
    """通用音频转换和淡入处理：输入任意格式，输出指定格式"""
    seg = AudioSegment.from_file(io.BytesIO(raw_bytes), format=in_fmt)
    # （可选）如果你遇到明显的"咔哒"粘连，也可以裁掉前 50~120ms：
    # seg = seg[50:]
    seg = seg.fade_in(fade_ms)
    out = io.BytesIO()
    # 如需恒定码率：bitrate 可按需调整
    seg.export(out, format=out_fmt, bitrate="192k")
    return out.getvalue()

# —— 新版：更稳健的成品后处理 —— 
from pydub import AudioSegment, effects

def _find_speech_onset_adaptive(seg: AudioSegment, max_scan_ms=8000, chunk_ms=10) -> int:
    """
    在前 max_scan_ms 内自适应寻找"语音真正开始"的位置（单位: ms）
    - 以前 2s 的 20 分位能量作为噪声地板，阈值 = max(-35dBFS, 噪声地板 + 8dB)
    - 需要连续 >=180ms 的帧超过阈值（更稳）
    - 额外引入斜率判定：与前300ms移动平均相比，增益 >= 6dB 才视为有效上升沿
    """
    scan = seg[:max_scan_ms].set_channels(1)
    # 分帧求 dBFS（静音帧置为 -100）
    frames = []
    for i in range(0, len(scan), chunk_ms):
        ch = scan[i:i+chunk_ms]
        db = ch.dBFS if ch.rms > 0 else -100.0
        frames.append(db)

    if not frames:
        return 0

    head_frames = frames[:max(1, int(2000/chunk_ms))]  # 头 2s
    head_sorted = sorted(head_frames)
    floor_db = head_sorted[int(0.2 * (len(head_sorted)-1))]  # 20 分位
    thr = max(-35.0, floor_db + 8.0)  # 自适应阈值（带绝对下限）

    continuity_ms = 180
    need = max(1, int(continuity_ms/chunk_ms))  # 至少 180ms 连续超过阈值
    slope_window_ms = 300
    slope_win = max(1, int(slope_window_ms/chunk_ms))
    slope_gain_db = 6.0
    thr_high = thr + 3.0  # 轻微滞回，减少在噪声边缘抖动

    # 先按“斜率+连续性”寻找更可信的上升沿
    for idx in range(len(frames)):
        v = frames[idx]
        # 与前300ms移动平均对比的增益
        if idx == 0:
            continue
        start_avg = max(0, idx - slope_win)
        prev = frames[start_avg:idx]
        if not prev:
            continue
        avg_prev = sum(prev) / float(len(prev))
        gain = v - avg_prev

        if v > thr_high and gain >= slope_gain_db:
            # 检查过去 need 区间是否基本保持在阈值以上
            start_check = max(0, idx - need + 1)
            sustained = all(frames[j] > thr for j in range(start_check, idx + 1))
            if sustained:
                return max(0, (start_check) * chunk_ms - 20)  # 回退20ms防切口

    # 回退方案：只按连续性超过阈值判断
    over = 0
    for idx, v in enumerate(frames):
        over = over + 1 if v > thr else 0
        if over >= need:
            start_ms = max(0, (idx - need + 1) * chunk_ms - 20)
            return start_ms

    # 若未检测到明显语音起点：最多硬裁 5s 作为保险
    return min(5000, max_scan_ms)

def _trim_trailing_noise(seg: AudioSegment, chunk_ms=10, tail_silence_db=-40.0, min_tail_ms=400):
    """
    去掉结尾长尾底噪/空气声：从尾部回扫，当连续 ≥min_tail_ms 低于阈值则截断
    """
    thr = tail_silence_db
    frames = []
    for i in range(len(seg)-chunk_ms, -1, -chunk_ms):
        ch = seg[i:i+chunk_ms]
        db = ch.dBFS if ch.rms > 0 else -100.0
        frames.append(db)
        if len(frames) * chunk_ms >= min_tail_ms and all(d < thr for d in frames):
            cut = max(0, i)
            return seg[:cut]
    return seg

def _find_energy_fallback_start(seg: AudioSegment, max_scan_ms: int) -> int:
    """
    能量门限兜底搜索：当VAD和自适应都失败时使用
    寻找首个≥120ms的非静音段
    """
    try:
        from pydub.silence import detect_nonsilent
        
        scan_seg = seg[:max_scan_ms]
        
        # 使用更严格的能量门限检测
        regions = detect_nonsilent(
            scan_seg, 
            min_silence_len=120,  # 至少120ms连续非静音
            silence_thresh=scan_seg.dBFS - 25,  # -25dB相对阈值
            seek_step=10  # 10ms步长
        )
        
        if regions:
            start_ms = max(0, regions[0][0] - 50)  # 预留50ms
            logging.info(f"能量门限兜底找到起点: {start_ms}ms")
            return start_ms
        
        return 0
        
    except Exception as e:
        logging.error(f"能量门限兜底搜索失败: {e}")
        return 0

def _find_speech_onset_vad(seg: AudioSegment,
                           max_scan_ms: int = 8000,
                           frame_ms: int = 30,
                           pre_roll_ms: int = 60,
                           min_voiced_ms: int = 240) -> int:
    """
    用 WebRTC VAD 查找"第一个稳定人声"起点；返回毫秒位置。
    - 激进度=3（最严），避免把"空气声/嘶声"当人声
    - 需要连续 >= min_voiced_ms 的"有声"帧
    - 起点前保留 pre_roll_ms 预滚，避免切掉首音节起始瞬态
    """
    if not _HAS_VAD:
        return 0
        
    # VAD 需 16k / 16-bit PCM / mono；只对前 max_scan_ms 进行扫描
    scan = seg[:max_scan_ms].set_channels(1).set_frame_rate(16000).set_sample_width(2)
    raw = scan.raw_data
    vad = webrtcvad.Vad(3)

    bytes_per_frame = int(16000 * (frame_ms / 1000.0)) * 2  # 2 bytes per sample
    need = max(1, int(min_voiced_ms / frame_ms))

    consec = 0
    i = 0
    raw_len = len(raw)
    max_bytes = min(raw_len, int(16000 * (max_scan_ms / 1000.0)) * 2)
    while i + bytes_per_frame <= max_bytes:
        frame = raw[i:i + bytes_per_frame]
        if vad.is_speech(frame, 16000):
            consec += 1
            if consec >= need:
                # 定位到当前帧的起点，退 pre_roll 作为保守预滚
                ms = int((i / 2) / 16000 * 1000)
                return max(0, ms - pre_roll_ms)
        else:
            consec = 0
        i += bytes_per_frame

    # 未检测到稳定人声则回退到 0
    return 0

def _to_mono16k(segment: AudioSegment) -> AudioSegment:
    """转 16k/mono/16bit，小分辨率便于快速做 VAD 与能量扫描"""
    return segment.set_frame_rate(16000).set_channels(1).set_sample_width(2)

def _scan_onset_energy(segment: AudioSegment,
                       max_scan_ms: int,
                       frame_ms: int = 20,
                       energy_dbfs: float = TTS_ONSET_ENERGY_DBFS,
                       min_voice_ms: int = TTS_MIN_VOICE_MS) -> int:
    """
    仅基于能量的起点估计：找到连续若干帧(dBFS高于阈值)的最早位置。
    返回毫秒位置；未找到则 0。
    """
    end_ms = min(len(segment), max_scan_ms)
    consec = 0
    start_ms = 0
    for t in range(0, end_ms, frame_ms):
        sl = segment[t:t+frame_ms]
        if sl.dBFS > energy_dbfs:
            if consec == 0:
                start_ms = t
            consec += frame_ms
            if consec >= min_voice_ms:
                return max(0, start_ms - 10)  # 微量前置，保护起音
        else:
            consec = 0
    return 0

def _scan_onset_vad(segment: AudioSegment,
                    max_scan_ms: int,
                    frame_ms: int = 30,
                    min_voice_ms: int = TTS_MIN_VOICE_MS) -> int:
    """
    基于 WebRTC VAD 的起点估计。需要 webrtcvad 可用。
    """
    try:
        import webrtcvad
    except Exception:
        return 0

    vad = webrtcvad.Vad(2)  # 0-3，数值越大越"挑剔"
    seg = _to_mono16k(segment)
    raw = seg.raw_data
    bytes_per_frame = int(16000 * 2 * frame_ms / 1000)  # 16k * 2bytes * frame_ms
    consec = 0
    start_ms = 0
    for idx, t in enumerate(range(0, min(len(seg), max_scan_ms), frame_ms)):
        frame = raw[idx*bytes_per_frame:(idx+1)*bytes_per_frame]
        if len(frame) < bytes_per_frame:
            break
        is_voiced = vad.is_speech(frame, 16000)
        if is_voiced:
            if consec == 0:
                start_ms = t
            consec += frame_ms
            if consec >= min_voice_ms:
                return max(0, start_ms - 10)
        else:
            consec = 0
    return 0


def _load_audio_segment(raw_bytes: bytes, declared_format: Optional[str]) -> tuple[AudioSegment, str]:
    """Decode raw audio bytes using the declared format, falling back when mismatched."""
    fmt = (declared_format or '').strip().lower()
    candidates: list[Optional[str]] = []
    if fmt:
        candidates.append(fmt)
    if fmt == 'wav':
        candidates.append('mp3')
    elif fmt == 'mp3':
        candidates.append('wav')
    else:
        for fallback in ('mp3', 'wav'):
            if fallback != fmt:
                candidates.append(fallback)
    candidates.append(None)

    last_exc: Optional[Exception] = None
    for candidate in candidates:
        try:
            bio = io.BytesIO(raw_bytes)
            if candidate is None:
                segment = AudioSegment.from_file(bio)
                detected = fmt or 'unknown'
            else:
                segment = AudioSegment.from_file(bio, format=candidate)
                detected = candidate
            return segment, detected
        except Exception as exc:
            last_exc = exc
    raise last_exc if last_exc else RuntimeError('unable to decode audio payload')




def _cosine_similarity(seg_a: AudioSegment, seg_b: AudioSegment) -> float:
    """Compute cosine similarity between two mono AudioSegment objects."""
    try:
        arr_a = np.array(seg_a.get_array_of_samples(), dtype=np.float32)
        arr_b = np.array(seg_b.get_array_of_samples(), dtype=np.float32)
    except Exception:
        return 0.0
    length = min(len(arr_a), len(arr_b))
    if length == 0:
        return 0.0
    arr_a = arr_a[:length] - arr_a[:length].mean()
    arr_b = arr_b[:length] - arr_b[:length].mean()
    norm_a = np.linalg.norm(arr_a)
    norm_b = np.linalg.norm(arr_b)
    if norm_a < 1e-6 or norm_b < 1e-6:
        return 0.0
    return float(np.dot(arr_a, arr_b) / (norm_a * norm_b))


def _strip_reference_prefix(segment: AudioSegment, references: list[AudioSegment]) -> tuple[AudioSegment, int]:
    """Remove leading chunks that match the provided reference segments."""
    if not references:
        return segment, 0

    current = segment
    removed = 0
    for ref in references:
        if not isinstance(ref, AudioSegment):
            continue
        ref_len = len(ref)
        if ref_len < 400 or len(current) <= ref_len + 200:
            continue
        head = current[:ref_len]
        similarity = _cosine_similarity(head, ref)
        if similarity >= 0.9:
            current = current[ref_len:]
            removed += ref_len
            continue
        window = min(ref_len, 2000)
        if window >= 400:
            head_short = head[:window]
            ref_short = ref[:window]
            if _cosine_similarity(head_short, ref_short) >= 0.92:
                current = current[window:]
                removed += window
    return current, removed

def postprocess_tts_audio(audio_bytes: bytes,
                          fmt: str = "mp3", 
                          max_scan_ms: int = None) -> tuple[bytes, int]:
    """
    入口：对 SiliconFlow 返回的整段音频做首端修剪 + 低频抑制 + 轻微淡入。
    返回：(processed_bytes, speech_onset_ms)
    """
    # 读入并统一
    segment, detected_fmt = _load_audio_segment(audio_bytes, fmt)
    if detected_fmt != (fmt or '').lower():
        logging.info(f'TTS postprocess: detected format {detected_fmt} (declared {fmt})')
    seg = segment.set_channels(1).set_frame_rate(24000)

    # —— 首秒高通（按需） —— 
    if TTS_HIGHPASS_HZ and TTS_HIGHPASS_HZ > 20:
        try:
            head = seg[:1000].high_pass_filter(TTS_HIGHPASS_HZ)
            tail = seg[1000:]
            seg = head.append(tail, crossfade=100)  # 80~120ms 交叉淡化
        except Exception:
            pass

    # —— 起点候选（更严格） —— 
    scan_window = max_scan_ms if max_scan_ms is not None else TTS_MAX_SCAN_MS
    vad_start = _find_speech_onset_vad(seg, max_scan_ms=scan_window, frame_ms=30,
                                       pre_roll_ms=60, min_voiced_ms=max(360, TTS_MIN_VOICE_MS))
    ada_start = _find_speech_onset_adaptive(seg, max_scan_ms=scan_window, chunk_ms=10)

    candidates = [x for x in (vad_start, ada_start) if isinstance(x, int)]
    onset = max(candidates) if candidates else 0  # 取更靠后的起点，更保守

    trimmed = seg[onset:]
    if onset > 0 and TTS_PAD_LEADING_MS > 0:
        trimmed = AudioSegment.silent(duration=TTS_PAD_LEADING_MS) + trimmed
        trimmed = trimmed.fade_in(8)

    # 导出保持原格式（后面再统一 mp3）
    buf = io.BytesIO()
    export_fmt = fmt if fmt in ("mp3","wav","opus","pcm") else "wav"
    trimmed.export(buf, format=export_fmt, bitrate="128k" if export_fmt=="mp3" else None)
    return buf.getvalue(), onset

def postprocess_and_save(raw_bytes: bytes, out_mp3_path: Path, src_format: str = "wav"):
    """
    MOSS-TTSD 专用后处理：WAV → 剪裁 → 转 MP3
    确保顺序：WAV → 剪裁 → 转 MP3
    """
    from pydub.effects import high_pass_filter
    from pydub.silence import detect_nonsilent
    
    # 读入 wav（使用内存流，避免临时文件）
    segment, detected_fmt = _load_audio_segment(raw_bytes, src_format)
    if detected_fmt != (src_format or '').lower():
        logging.info(f'MOSS postprocess: detected format {detected_fmt} (declared {src_format})')
    seg = segment

    # 1) 高通去低频轰鸣（可关）
    hp = int(os.getenv("TTS_HIGHPASS_HZ", "60"))
    if hp > 0:
        seg = high_pass_filter(seg, hp)

    # 2) 动态阈值找首音到达
    #    以整体 dBFS-8dB 为阈值，最短有声 240ms，可调
    thr = seg.dBFS - 8
    windows = detect_nonsilent(seg, min_silence_len=int(os.getenv("TTS_MIN_VOICE_MS", "240")),
                               silence_thresh=thr, seek_step=10)
    if windows:
        onset = windows[0][0]
        onset = max(0, onset - int(os.getenv("TTS_PAD_LEADING_MS", "60")))  # 微留白
        seg = seg[onset:]

    # 3) （可选）WebRTC-VAD 二次确认（你的项目已装 webrtcvad，可按需补充）

    # 4) 转 MP3 落盘
    out_mp3_path.parent.mkdir(parents=True, exist_ok=True)
    seg.export(out_mp3_path, format="mp3", bitrate="128k")



def _collect_reference_segments(voices: list[Voice], target_rate: int = 24000) -> list[AudioSegment]:
    """Load voice reference audio segments for prefix stripping."""
    segments: list[AudioSegment] = []
    for voice in voices or []:
        try:
            ref_path = Path(voice.audio_path)
            if not ref_path.exists():
                logging.warning(f"Reference audio missing for voice {voice.id}: {voice.audio_path}")
                continue
            segment = AudioSegment.from_file(ref_path)
            segment = segment.set_channels(1).set_frame_rate(target_rate)
            segments.append(segment)
        except Exception as exc:
            logging.warning(f"Failed to load reference audio for voice {getattr(voice, 'id', '?')}: {exc}")
    return segments

def finalize_tts_output(raw_bytes: bytes, src_format: str = "wav", target_format: str = "mp3", max_scan_ms: int = None, reference_segments: Optional[list[AudioSegment]] = None) -> tuple[bytes, int]:
    """
    统一规格 → Hybrid起点裁切 → 首秒安全门 → 头部轻处理 → 高通/淡入 → 轻度归一化 → 裁长尾 → 导出
    
    参数:
        raw_bytes: 原始音频字节数据
        src_format: 源音频格式
        target_format: 目标导出格式
        max_scan_ms: 起点搜寻扫描窗（毫秒），默认使用环境变量 TTS_MAX_SCAN_MS
    """
    segment, detected_fmt = _load_audio_segment(raw_bytes, src_format)
    if detected_fmt != (src_format or '').lower():
        logging.info(f'TTS finalize: detected format {detected_fmt} (declared {src_format})')

    # 统一：单声道 / 24k（与克隆端一致，避免不同设备解码差异）
    seg = segment.set_channels(1).set_frame_rate(24000)

    removed_prefix_ms = 0
    if reference_segments:
        try:
            prepared_refs = [ref.set_channels(1).set_frame_rate(seg.frame_rate) for ref in reference_segments]
            seg, removed_prefix_ms = _strip_reference_prefix(seg, prepared_refs)
            if removed_prefix_ms:
                logging.info(f'Removed {removed_prefix_ms}ms of reference audio prefix')
        except Exception as exc:
            logging.warning(f'Reference prefix stripping failed: {exc}')

    # --- 起点候选 ---
    vad_start = None
    ada_start = None
    
    # 使用参数或环境变量配置扫描窗
    scan_window = max_scan_ms if max_scan_ms is not None else TTS_MAX_SCAN_MS

    if TTS_TRIM_STRATEGY in ("hybrid", "vad") and _HAS_VAD:
        vad_start = _find_speech_onset_vad(seg, max_scan_ms=scan_window, frame_ms=30,
                                           pre_roll_ms=60, min_voiced_ms=240)

    if TTS_TRIM_STRATEGY in ("hybrid", "adaptive") or not _HAS_VAD:
        ada_start = _find_speech_onset_adaptive(seg, max_scan_ms=scan_window, chunk_ms=10)

    # 组合规则（更保守）：优先取"更靠后"的那个起点
    candidates = []
    if isinstance(vad_start, int): 
        candidates.append(vad_start)
    # 始终纳入自适应起点候选（去掉5000魔法值限制）
    if isinstance(ada_start, int): 
        candidates.append(ada_start)

    if candidates:
        start_ms = max(candidates)
    else:
        # 都不可信：在扫描窗内用能量门限再搜一次
        logging.warning("VAD和自适应都失败，使用能量门限兜底搜索")
        start_ms = _find_energy_fallback_start(seg, scan_window)
        if start_ms == 0:
            # 最后兜底：保守砍掉更多
            start_ms = min(6000, scan_window)
            logging.warning(f"能量门限搜索也失败，使用保守兜底: {start_ms}ms")

    # 可观测性日志（增强解释性）
    logging.info(f"TTS trim analysis: scan_window={scan_window}ms, vad_start={vad_start}ms, ada_start={ada_start}ms, chosen={start_ms}ms")

    seg = seg[start_ms:]

    # 增强安全门：裁切后的前 1500ms 再确认非静音起点
    head = seg[:1500]
    # 以头段平均电平为准，阈值提高 22dB；要求至少 160ms 连续非静音
    regions = detect_nonsilent(head, min_silence_len=160, silence_thresh=head.dBFS - 22, seek_step=5)
    if regions:
        safe_shift = max(0, regions[0][0] - 10)  # 预留 10ms 裁切余量
        if safe_shift > 0:
            logging.info(f"安全门进一步裁切: {safe_shift}ms")
            seg = seg[safe_shift:]

    # —— 头部轻处理：抑制"高频空气声/嘶声"的听感 —— 
    # 仅对开头 180ms 做轻低通 + 极短淡入，再与后续拼接交叉淡化
    if len(seg) > 180:
        head = seg[:180].low_pass_filter(12000).fade_in(12)
        seg = head.append(seg[180:], crossfade=12)
    else:
        seg = seg.fade_in(12)

    # 去 DC/极低频轰鸣
    seg = seg.high_pass_filter(60)

    # 轻度归一化，保留 1dB 头间隙
    seg = effects.normalize(seg, headroom=1.0)

    # 裁掉结尾空气声（避免末尾"呼呼"）
    seg = _trim_trailing_noise(seg, chunk_ms=10, tail_silence_db=-40.0, min_tail_ms=400)

    # 高质量导出（VBR 约 192–224kbps）
    out_buf = io.BytesIO()
    seg.export(out_buf, format=target_format, parameters=["-q:a", "3"])
    
    # 返回处理后的音频字节和首音到达时间
    return out_buf.getvalue(), start_ms

def _postprocess_preview_bytes(raw_bytes: bytes, src_format: str = "wav") -> bytes:
    """消除预览开头的瞬态/噪声：去DC+淡入+裁剪前导低电平+轻度归一化，输出高质量MP3字节"""
    seg = AudioSegment.from_file(io.BytesIO(raw_bytes), format=src_format)

    # 裁掉最多前 1500ms 的低电平噪声（阈值=整体 dBFS - 25dB，更保守）
    head = seg[:1500]
    regions = detect_nonsilent(head, min_silence_len=5, silence_thresh=head.dBFS - 25, seek_step=1)
    if regions:
        start = max(0, regions[0][0] - 5)  # 留 5ms 余量
        seg = seg[start:]

    # 去 DC & 柔化起始
    seg = seg.high_pass_filter(35).fade_in(15)

    # 轻度归一化，保留 1dB 余量
    seg = effects.normalize(seg, headroom=1.0)

    # 统一以高质量 MP3 导出（等效 ~192-224kbps VBR）
    out_buf = io.BytesIO()
    seg.export(out_buf, format="mp3", parameters=["-q:a", "3"])
    return out_buf.getvalue()

def get_voice_by_id_or_403(voice_id: int) -> Voice:
    """通过ID获取音色，并验证权限"""
    voice = Voice.query.get_or_404(voice_id)
    if not (voice.is_global or voice.user_id == current_user.id):
        abort(403, '无权使用该音色')
    return voice

def tts_with_voice_uri(script: str, voice_uri: str, client, mode: str = 'single') -> bytes:
    """使用预置音色URI进行TTS合成"""
    
    # 单人模式：净化文本，去掉标签，让模型在纯文本域启动
    if mode == 'single':
        clean_input = sanitize_single_text(script)
        language_hint = 'zh' if has_chinese(clean_input) else 'en'
        logging.info(f"单人模式净化文本: 原文长度={len(script)}, 净化后长度={len(clean_input)}")
    else:
        clean_input = script
        language_hint = 'zh' if has_chinese(script) else 'en'
    
    body = {
        "model": SF_TTS_MODEL,
        "voice": voice_uri,
        "input": clean_input,
        "response_format": SF_TTS_FORMAT,  # 与配置同步
        "speed": 1.0
    }
    extra_body = {
        "language": language_hint  # 语言锁
    }
    
    with client.audio.speech.with_streaming_response.create(**body, extra_body=extra_body) as response:
        if response.status_code != 200:
            error_content = response.text
            logging.error(f"SiliconFlow API 错误 (voice_uri): {error_content}")
            raise Exception(f"音频合成服务失败: {error_content}")
        return response.read()

_SEGMENT_RE = re.compile(r'\[\s*[Ss]([12])\s*\](.*?)(?=\[\s*[Ss][12]\s*\]|$)', re.DOTALL)

def _ensure_voice_uri(voice, api_key: str, base_url: str) -> str:
    """Return voice.voice_uri, uploading to SiliconFlow if not yet stored."""
    if voice.voice_uri:
        return voice.voice_uri
    uri = upload_voice_to_siliconflow(voice, api_key, base_url)
    if not uri:
        raise Exception(f"无法上传音色 '{voice.name}' 到 SiliconFlow")
    voice.voice_uri = uri
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
    return uri


def tts_cosyvoice_per_turn(script: str, voices: list, mode: str, client,
                            api_key: str, base_url: str) -> bytes:
    """
    用 CosyVoice2 按说话人分段合成，再拼接成完整音频。

    - 单人模式：去掉所有 [Sx] 标签，用 voices[0] 的音色整段合成
    - 对话模式：按 [S1]/[S2] 分段，各段用对应音色合成后拼接
    """
    COSYVOICE_MODEL = "FunAudioLLM/CosyVoice2-0.5B"
    TURN_SILENCE_MS = 300  # 轮次之间的静音间隔

    def _synth_turn(text: str, voice_uri: str) -> AudioSegment:
        text = text.strip()
        if not text:
            return AudioSegment.silent(duration=0)
        lang = 'zh' if has_chinese(text) else 'en'
        body = {
            "model": COSYVOICE_MODEL,
            "voice": voice_uri,
            "input": text,
            "response_format": "mp3",
            "speed": 1.0,
        }
        with client.audio.speech.with_streaming_response.create(
            **body, extra_body={"language": lang}
        ) as resp:
            if resp.status_code != 200:
                raise Exception(f"CosyVoice2 API 错误: {resp.text}")
            raw = resp.read()
        return AudioSegment.from_file(io.BytesIO(raw), format="mp3")

    if mode == 'single':
        clean = re.sub(r'\[\s*[Ss][12]\s*\]', '', script).strip()
        uri = _ensure_voice_uri(voices[0], api_key, base_url)
        logging.info(f"CosyVoice2 单人合成 | voice={voices[0].name} | len={len(clean)}")
        seg = _synth_turn(clean, uri)
    else:
        # 对话模式：解析分段
        segments = [(int(m.group(1)), m.group(2).strip())
                    for m in _SEGMENT_RE.finditer(script)
                    if m.group(2).strip()]
        if not segments:
            raise ValueError("对话脚本中找不到 [S1]/[S2] 分段")

        uris = [_ensure_voice_uri(v, api_key, base_url) for v in voices]
        silence = AudioSegment.silent(duration=TURN_SILENCE_MS)

        parts: list[AudioSegment] = []
        for spk_idx, text in segments:
            voice_idx = min(spk_idx - 1, len(uris) - 1)
            logging.info(f"CosyVoice2 对话合成 | S{spk_idx}={voices[voice_idx].name} | len={len(text)}")
            parts.append(_synth_turn(text, uris[voice_idx]))

        seg = parts[0]
        for p in parts[1:]:
            seg = seg + silence + p

    out = io.BytesIO()
    seg.export(out, format="mp3", bitrate="192k")
    return out.getvalue()


def tts_with_dynamic_refs(script: str, voices: list, mode: str, client) -> bytes:
    """使用动态references进行TTS合成（降级方案）"""
    import base64
    
    refs = []
    plan = [('s1','[S1]')] if mode != 'role' or len(voices) == 1 else [('s1','[S1]'),('s2','[S2]')]
    
    for idx, (key, tag) in enumerate(plan):
        if idx >= len(voices):
            break
        voice = voices[idx]
        audio_path = Path(voice.audio_path)
        
        # 读取音频文件
        with open(audio_path, "rb") as f:
            audio_bytes = f.read()
        
        # 检测MIME类型
        mime_types = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav', 
            '.m4a': 'audio/mp4',
            '.flac': 'audio/flac',
            '.ogg': 'audio/ogg',
            '.opus': 'audio/opus',
            '.webm': 'audio/webm',
            '.aac': 'audio/aac'
        }
        mime_type = mime_types.get(audio_path.suffix.lower(), 'application/octet-stream')
        
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        # 处理参考文本
        base_text = (voice.text or "").strip()
        if mode != 'role':
            # 单人：只用纯文本，不要标签
            safe_text = _sanitize_reference_text_for_single(base_text) or VOICE_PREVIEW_TEXT_SINGLE
            ref_text = f"{tag} {_clean_s_prefix(safe_text)}".strip()
        else:
            # 对话：保留 [S1]/[S2] 以帮助说话人切换
            base_text = _clean_s_prefix(base_text) or VOICE_PREVIEW_TEXT_ROLE
            ref_text = f'{tag} {base_text}'.strip()
        
        refs.append({
            "audio": f"data:{mime_type};base64,{audio_base64}", 
            "text": ref_text
        })
    
    body = {
        "model": SF_TTS_MODEL,
        "voice": "",
        "input": script,
        "response_format": SF_TTS_FORMAT,
        "speed": 1.0
    }
    
    # 语言锁：根据脚本内容判断语言
    language_hint = 'zh' if has_chinese(script) else 'en'
    
    extra_body = {
        "references": refs,
        "max_tokens": SF_TTS_MAX_TOKENS,
        "max_new_tokens": SF_TTS_MAX_TOKENS,
        "language": language_hint
    }
    
    with client.audio.speech.with_streaming_response.create(**body, extra_body=extra_body) as response:
        if response.status_code != 200:
            error_content = response.text
            logging.error(f"SiliconFlow API 错误 (dynamic_refs): {error_content}")
            raise Exception(f"音频合成服务失败: {error_content}")
        return response.read()

def tts_with_moss_references(script: str, voices: list, mode: str, client) -> bytes:
    """
    使用 SiliconFlow MOSS-TTSD 合成音频。

    对齐官方用法要点：
      - MOSS-TTSD v0.5 是双人对话模型，官方警告单人参考效果差
      - references 数组顺序决定 [S1]/[S2] 对应关系
      - 单人模式：复制同一个 voice 成 2 条 reference，input 仅含 [S1]，
        让模型拿到它熟悉的双人结构，但只生成 S1 部分
      - reference.text 是纯转录，不含 [Sx] 标签
      - voice 顶层字段必须为空（与 references 互斥）

    环境变量开关：
      - TTS_DEBUG_DUMP=1           把 API 原始返回 dump 到 debug_last_tts.<ext>
      - TTS_ENABLE_POSTPROCESS=1   启用本地 finalize_tts_output 后处理（默认关闭）
    """
    try:
        is_single = (mode == "single")
        text = (script or "").strip()
        if not text:
            raise ValueError("待合成脚本为空")

        # --- 构造 input 文本 ---
        if is_single:
            # 单人模式：把所有 [S2] 改成 [S1]，并确保以 [S1] 起始
            text = re.sub(r'\[\s*[sS]\s*2\s*\]', '[S1]', text)
            if not text.lstrip().startswith("[S1]"):
                text = "[S1]" + text
            # 复制同一个 voice 成 2 条 reference（对齐官方双人架构）
            voice_records = [(voices[0], "S1"), (voices[0], "S2")]
        else:
            if len(voices) < 2:
                raise ValueError("对话模式需要 2 个音色")
            voice_records = [(voices[0], "S1"), (voices[1], "S2")]

        refs = build_moss_references(voice_records)

        # --- 构造请求参数（完全对齐 SiliconFlow 官方示例）---
        # 参考: https://docs.siliconflow.cn/cn/userguide/capabilities/text-to-speech 5.4 节
        response_format = (SF_TTS_FORMAT or "mp3").lower()
        params = {
            "model": "fnlp/MOSS-TTSD-v0.5",
            "voice": "",
            "input": text,
            "response_format": response_format,
            "speed": 1,
            "extra_body": {
                "references": refs,
                "max_tokens": int(os.getenv("SF_TTS_MAX_TOKENS", "1600")),  # 官方默认 1600
                "stream": True,
                "gain": 0,
            }
        }

        ref0_preview = (refs[0].get("text") or "")[:30]
        logging.info(
            f"MOSS-TTSD 请求 | mode={mode} | refs={len(refs)} | "
            f"input_len={len(text)} | ref0_text='{ref0_preview}...'"
        )

        with client.audio.speech.with_streaming_response.create(**params) as resp:
            if resp.status_code != 200:
                error_content = resp.text
                logging.error(f"MOSS-TTSD API 错误: {error_content}")
                raise Exception(f"音频合成服务失败: {error_content}")
            raw_bytes = resp.read()

        if not raw_bytes:
            raise Exception("MOSS-TTSD API 返回空音频")

        logging.info(f"MOSS-TTSD API 返回 {len(raw_bytes)} 字节 ({response_format})")

        # --- 调试：dump API 原始返回 ---
        if os.getenv("TTS_DEBUG_DUMP", "0") == "1":
            try:
                dump_path = Path(f"debug_last_tts.{response_format}")
                dump_path.write_bytes(raw_bytes)
                logging.info(f"[DEBUG] API 原始返回已保存到 {dump_path.resolve()}")
            except Exception as exc:
                logging.warning(f"[DEBUG] dump 失败: {exc}")

        # --- 本地后处理（默认关闭）---
        if os.getenv("TTS_ENABLE_POSTPROCESS", "0") == "1":
            ref_segments = _collect_reference_segments(
                [v for v, _ in voice_records], target_rate=24000
            )
            processed_bytes, start_ms = finalize_tts_output(
                raw_bytes,
                src_format=response_format,
                target_format="mp3",
                reference_segments=ref_segments,
            )
            logging.info(f"MOSS-TTSD 后处理启用，首音起点: {start_ms}ms")
            return processed_bytes

        # --- 默认路径：只做格式转换到 MP3，不动音频内容 ---
        if response_format == "mp3":
            return raw_bytes
        seg = AudioSegment.from_file(io.BytesIO(raw_bytes), format=response_format)
        out_buf = io.BytesIO()
        seg.export(out_buf, format="mp3", bitrate="192k")
        return out_buf.getvalue()

    except Exception as e:
        logging.error(f"MOSS-TTSD 合成异常: {e}", exc_info=True)
        raise Exception(f"MOSS-TTSD 音频合成失败: {str(e)}")

_UPLOAD_MAX_MS = 8_000   # 上传给 SiliconFlow 的参考音频上限：8 秒
# CosyVoice2 若参考文本比音频长，会先补完文本再生成正文（"末尾泄漏"）。
# 安全字符数 = 8s × 估算语速，中文约 5 字/秒，英文约 12 字符/秒。
_UPLOAD_SAFE_CHARS_ZH = 40   # 中文安全上限（约 8s × 5 字/s）
_UPLOAD_SAFE_CHARS_EN = 96   # 英文安全上限（约 8s × 12 chars/s）


def _trim_ref_text_for_upload(text: str) -> str:
    """
    截短参考文本，确保 8 秒内能读完，避免 CosyVoice2 末尾泄漏。
    按语言分别限制字符数，截断点取最近的句子/词语边界。
    """
    if not text:
        return text
    is_zh = has_chinese(text)
    limit = _UPLOAD_SAFE_CHARS_ZH if is_zh else _UPLOAD_SAFE_CHARS_EN
    if len(text) <= limit:
        return text
    # 在 limit 附近找自然断点（句号、感叹号、逗号、空格）
    cut = text[:limit]
    for punct in ('。', '！', '？', '，', '.', '!', '?', ',', ' '):
        idx = cut.rfind(punct)
        if idx > limit // 2:
            return cut[:idx + 1].strip()
    return cut.strip()


def upload_voice_to_siliconflow(voice_obj, api_key, base_url):
    """
    上传本地音色样本，成功返回 voice_uri（如 "speech:your-voice-name:xxxx"）
    目标接口：POST {base}/v1/uploads/audio/voice

    上传前自动处理：
      - 音频截到 8 秒（避免参考音频过长，CosyVoice2 末尾泄漏）
      - 参考文本同步截短（中文 ≤40 字，英文 ≤96 字符）
    """
    import requests
    from pathlib import Path

    try:
        base = (base_url or "").rstrip("/")
        url = base + ("/uploads/audio/voice" if base.endswith("/v1") else "/v1/uploads/audio/voice")

        p = Path(voice_obj.audio_path)
        if not p.exists():
            raise FileNotFoundError(f"音色文件不存在: {p}")

        # 音频规格化：截到 8 秒，单声道 16kHz MP3，确保和文本对齐
        audio = AudioSegment.from_file(p).set_channels(1).set_frame_rate(16000)
        if len(audio) > _UPLOAD_MAX_MS:
            audio = audio[:_UPLOAD_MAX_MS]
        audio_buf = io.BytesIO()
        audio.export(audio_buf, format="mp3", bitrate="192k")
        audio_buf.seek(0)

        # 参考文本：去标签 + 按语言截短
        raw_text = _sanitize_reference_text_for_single(getattr(voice_obj, "text", "") or "")
        safe_text = _trim_ref_text_for_upload(raw_text) or "你好，这是用于克隆的参考文本。"

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }
        data = {
            "model": "FunAudioLLM/CosyVoice2-0.5B",
            "customName": voice_obj.name,
            "text": safe_text,
        }
        files = {"file": (p.stem + ".mp3", audio_buf, "audio/mpeg")}
        logging.info(f"上传音色: {voice_obj.name} | audio={len(audio)/1000:.1f}s | text='{safe_text[:40]}...'")
        resp = requests.post(url, headers=headers, data=data, files=files, timeout=60)

        if resp.status_code in (200, 201):
            j = resp.json()
            voice_uri = j.get("voice") or j.get("voice_uri") or j.get("uri")
            if voice_uri:
                logging.info(f"上传音色成功，获得 voice_uri: {voice_uri}")
            return voice_uri
            logging.error(f"上传返回无 voice_uri，响应: {j}")
            return None

        logging.error(f"上传音色到 SiliconFlow 失败: {resp.status_code} - {resp.text} (url={url})")
        return None

    except Exception as e:
        logging.exception(f"上传音色到 SiliconFlow 异常: {e}")
        return None


def clean_reference_wav(path_in: str, path_out: str) -> None:
    """
    清洗参考音频：去掉首尾空气声，限制时长，提高质量
    避免把"参考音频里的空气声/吸气"风格化带入最终成品
    """
    try:
        from pydub.silence import detect_nonsilent
        
        seg = AudioSegment.from_file(path_in)
        seg = seg.set_channels(1).set_frame_rate(24000)
        
        # 找首段非静音（-20dBFS相对阈值，持续≥120ms）
        regions = detect_nonsilent(seg, min_silence_len=120, silence_thresh=seg.dBFS - 20, seek_step=5)
        
        if regions:
            start = max(0, regions[0][0] - 80)     # 预留80ms
            end = min(len(seg), regions[-1][1] + 120)  # 预留120ms
            seg = seg[start:end]
        
        # 限长（最多10秒）
        if len(seg) > 10000:
            seg = seg[:10000]
        
        # 后处理：淡入淡出、高通滤波
        seg = seg.fade_in(10).fade_out(20).high_pass_filter(60)
        
        # 保存清洗后的音频
        seg.export(path_out, format="wav")
        
        logging.info(f"参考音频清洗完成: {path_in} -> {path_out}, 时长: {len(seg)/1000:.1f}s")
        
    except Exception as e:
        logging.error(f"参考音频清洗失败: {e}", exc_info=True)
        # 失败时复制原文件
        import shutil
        shutil.copy2(path_in, path_out)

def _clean_reference_audio(file_path: Path) -> None:
    """清洗参考音频：去DC、高通60Hz、裁剪前导500-800ms低电平段、轻度归一化，然后覆盖保存"""
    try:
        # 检查文件是否存在且不为空
        if not file_path.exists() or file_path.stat().st_size == 0:
            logging.warning(f"音频文件不存在或为空: {file_path}")
            return
        
        # 备份原始文件
        backup_path = file_path.with_suffix(file_path.suffix + '.backup')
        
        # 读取原始音频
        seg = AudioSegment.from_file(str(file_path))
        
        # 检查音频是否有效
        if len(seg) == 0:
            logging.warning(f"音频文件长度为0: {file_path}")
            return
        
        # 新增：统一为单声道/24k，提升声纹提取稳定性并与生成端一致
        seg = seg.set_channels(1).set_frame_rate(24000)
        
        # 裁掉最多前 800ms 的低电平噪声（阈值=整体 dBFS - 25dB）
        head = seg[:800]
        regions = detect_nonsilent(head, min_silence_len=10, silence_thresh=head.dBFS - 25, seek_step=1)
        if regions:
            start = max(0, regions[0][0] - 10)  # 留 10ms 余量
            seg = seg[start:]
        
        # 去 DC & 高通滤波（60Hz）
        seg = seg.high_pass_filter(60)
        
        # 轻度归一化，保留 1dB 余量
        seg = effects.normalize(seg, headroom=1.0)
        
        # 先备份原文件
        import shutil
        shutil.copy2(file_path, backup_path)
        
        # 覆盖保存原文件
        seg.export(str(file_path), format=file_path.suffix[1:])  # 保持原格式
        
        # 检查新文件是否有效
        if file_path.stat().st_size == 0:
            logging.error(f"清洗后的文件为空，恢复原文件: {file_path}")
            shutil.copy2(backup_path, file_path)
            backup_path.unlink()  # 删除备份
        else:
            backup_path.unlink()  # 删除备份
            logging.info(f"参考音频清洗完成: {file_path}")
            
    except Exception as e:
        logging.error(f"参考音频清洗失败 {file_path}: {e}", exc_info=True)
        # 清洗失败不影响主流程，继续使用原文件
        # 如果存在备份文件，恢复原文件
        backup_path = file_path.with_suffix(file_path.suffix + '.backup')
        if backup_path.exists():
            try:
                import shutil
                shutil.copy2(backup_path, file_path)
                backup_path.unlink()
                logging.info(f"已恢复原始音频文件: {file_path}")
            except Exception as restore_error:
                logging.error(f"恢复原始文件失败: {restore_error}")

# ------------------------- 4. 安全加固与审计功能 -------------------------

def log_auth_event(event_type, target=None, ip=None, user_id=None, success=True, details=None):
    """
    记录认证相关事件到日志
    :param event_type: 事件类型 ('request_code', 'verify_code', 'login', 'register')
    :param target: 邮箱或手机号
    :param ip: 客户端IP
    :param user_id: 用户ID（如果适用）
    :param success: 是否成功
    :param details: 额外详情
    """
    try:
        masked_target = None
        if target:
            if '@' in target:
                # 邮箱脱敏：u***@example.com
                parts = target.split('@')
                masked_target = f"{parts[0][:1]}***@{parts[1]}"
            else:
                # 手机号脱敏：138****8000
                masked_target = f"{target[:3]}****{target[-4:]}" if len(target) >= 7 else "***"
        
        log_msg = f"AUTH_EVENT: {event_type} | "
        log_msg += f"Target: {masked_target or 'None'} | "
        log_msg += f"IP: {ip or 'Unknown'} | "
        log_msg += f"UserID: {user_id or 'None'} | "
        log_msg += f"Success: {success}"
        
        if details:
            log_msg += f" | Details: {details}"
        
        if success:
            logging.info(log_msg)
        else:
            logging.warning(log_msg)
            
    except Exception as e:
        logging.error(f"审计日志记录失败: {e}")

def disable_excessive_attempts():
    """
    禁用尝试次数超过5次的验证码记录
    """
    try:
        excessive_codes = OTPCode.query.filter(OTPCode.attempts > 5).all()
        for code in excessive_codes:
            logging.warning(f"禁用超限验证码: {code.target[:3]}*** attempts={code.attempts}")
            db.session.delete(code)
        
        if excessive_codes:
            db.session.commit()
            return len(excessive_codes)
        return 0
        
    except Exception as e:
        logging.error(f"清理超限验证码失败: {e}")
        return 0

def enforce_unique_constraints():
    """
    检查并强制执行邮箱和手机号的唯一性约束
    返回是否有重复项被处理
    """
    try:
        # 检查邮箱重复
        email_duplicates = db.session.execute(text(
            "SELECT email, COUNT(*) as count FROM user WHERE email IS NOT NULL GROUP BY email HAVING count > 1"
        )).fetchall()
        
        # 检查手机号重复
        phone_duplicates = db.session.execute(text(
            "SELECT phone, COUNT(*) as count FROM user WHERE phone IS NOT NULL GROUP BY phone HAVING count > 1"
        )).fetchall()
        
        if email_duplicates or phone_duplicates:
            logging.warning(f"发现重复数据 - 邮箱: {len(email_duplicates)}, 手机号: {len(phone_duplicates)}")
            return True
        
        return False
        
    except Exception as e:
        logging.error(f"唯一性约束检查失败: {e}")
        return False

# 配置项：未来开关
ALLOW_LEGACY_PASSWORD_LOGIN = os.environ.get('ALLOW_LEGACY_PASSWORD_LOGIN', 'true').lower() == 'true'
ALLOW_PASSWORD_LOGIN = os.environ.get('ALLOW_PASSWORD_LOGIN', 'true').lower() == 'true'
REQUIRE_CONTACT_VERIFICATION = os.environ.get('REQUIRE_CONTACT_VERIFICATION', 'false').lower() == 'true'

# 强制启用传统密码登录（用于测试）
ALLOW_LEGACY_PASSWORD_LOGIN = True
ALLOW_PASSWORD_LOGIN = True

# OTP 服务配置
OTP_DEV_LOG_ONLY = os.environ.get('OTP_DEV_LOG_ONLY', 'true').lower() == 'true'

# 邮件服务配置
EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "smtp").lower()

# SendGrid 配置
SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
SENDGRID_FROM = os.environ.get("SENDGRID_FROM", "")
SENDGRID_FROM_NAME = os.environ.get("SENDGRID_FROM_NAME", "PodifyAI")
SENDGRID_SANDBOX = os.environ.get("SENDGRID_SANDBOX", "false").lower() == "true"

# SMTP 配置（备用通道）
EMAIL_FROM = os.environ.get('EMAIL_FROM', '')
SMTP_HOST = os.environ.get('SMTP_HOST', '')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))  # 端口可保留安全默认
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASS = os.environ.get('SMTP_PASS', '')
SMTP_USE_TLS = os.environ.get('SMTP_USE_TLS', 'true').lower() == 'true'

# Twilio 短信服务配置
TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', '')
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', '')
TWILIO_FROM_NUMBER = os.environ.get('TWILIO_FROM_NUMBER', '')

# 阿里云短信服务配置（可选，未来使用）
ALIYUN_ACCESS_KEY_ID = os.environ.get('ALIYUN_ACCESS_KEY_ID', '')
ALIYUN_ACCESS_KEY_SECRET = os.environ.get('ALIYUN_ACCESS_KEY_SECRET', '')
ALIYUN_SMS_SIGN_NAME = os.environ.get('ALIYUN_SMS_SIGN_NAME', 'PodifyAI')
ALIYUN_SMS_TEMPLATE_CODE = os.environ.get('ALIYUN_SMS_TEMPLATE_CODE', '')

# 腾讯云短信服务配置（可选，未来使用）
TENCENT_SECRET_ID = os.environ.get('TENCENT_SECRET_ID', '')
TENCENT_SECRET_KEY = os.environ.get('TENCENT_SECRET_KEY', '')
TENCENT_SMS_SDK_APP_ID = os.environ.get('TENCENT_SMS_SDK_APP_ID', '')
TENCENT_SMS_SIGN_NAME = os.environ.get('TENCENT_SMS_SIGN_NAME', 'PodifyAI')
TENCENT_SMS_TEMPLATE_ID = os.environ.get('TENCENT_SMS_TEMPLATE_ID', '')

# 启动时打印关键开关，确认 .env 已加载
logging.info(f"OTP_DEV_LOG_ONLY={OTP_DEV_LOG_ONLY}")
logging.info(f"EMAIL_PROVIDER={EMAIL_PROVIDER}")
logging.info(f"ALLOW_PASSWORD_LOGIN={ALLOW_PASSWORD_LOGIN}")

if EMAIL_PROVIDER == "sendgrid":
    logging.info(f"SENDGRID_FROM={SENDGRID_FROM}, SANDBOX={SENDGRID_SANDBOX}, API_KEY_SET={'YES' if bool(SENDGRID_API_KEY) else 'NO'}")
else:
    logging.info(f"SMTP_HOST={SMTP_HOST}, SMTP_PORT={SMTP_PORT}, SMTP_USER={'SET' if SMTP_USER else 'EMPTY'}, SMTP_USE_TLS={SMTP_USE_TLS}")

# ------------------------- 5. 数据库迁移与初始化 -------------------------

def check_column_exists(table_name, column_name):
    """检查数据库表中是否存在指定列"""
    try:
        result = db.session.execute(text(f"PRAGMA table_info({table_name})"))
        columns = [row[1] for row in result.fetchall()]
        return column_name in columns
    except Exception:
        return False

def check_table_exists(table_name):
    """检查数据库表是否存在"""
    try:
        result = db.session.execute(text(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'"))
        return result.fetchone() is not None
    except Exception:
        return False

def migrate_database():
    """
    数据库迁移函数，兼容现有用户
    为现有用户设置 is_verified=True，新用户需要验证
    """
    try:
        with app.app_context():
            # 首先检查是否需要添加新列
            need_migration = False
            
            if not check_column_exists('user', 'email'):
                logging.info("添加 email 列...")
                db.session.execute(text("ALTER TABLE user ADD COLUMN email VARCHAR(255)"))
                need_migration = True
            
            if not check_column_exists('user', 'phone'):
                logging.info("添加 phone 列...")
                db.session.execute(text("ALTER TABLE user ADD COLUMN phone VARCHAR(32)"))
                need_migration = True
            
            if not check_column_exists('user', 'is_verified'):
                logging.info("添加 is_verified 列...")
                db.session.execute(text("ALTER TABLE user ADD COLUMN is_verified BOOLEAN DEFAULT 0 NOT NULL"))
                need_migration = True
            
            if not check_column_exists('user', 'verified_at'):
                logging.info("添加 verified_at 列...")
                db.session.execute(text("ALTER TABLE user ADD COLUMN verified_at DATETIME"))
                need_migration = True
            
            # 检查 password_hash 字段
            if not check_column_exists('user', 'password_hash'):
                logging.info("添加 password_hash 列...")
                db.session.execute(text("ALTER TABLE user ADD COLUMN password_hash VARCHAR(256)"))
                need_migration = True
            else:
                logging.info("✅ password_hash 字段已存在")
            
            # 检查 credits 字段
            if not check_column_exists('user', 'credits'):
                logging.info("添加 credits 列...")
                db.session.execute(text("ALTER TABLE user ADD COLUMN credits INTEGER DEFAULT 30 NOT NULL"))
                need_migration = True
            else:
                logging.info("✅ credits 字段已存在")
            
            if need_migration:
                db.session.commit()
                logging.info("数据库结构更新完成")
            
            # 创建所有表（包括新表）
            db.create_all()
            
            # 创建部分唯一索引（忽略 NULL）
            try:
                db.session.execute(text("""
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
                    ON user (email) WHERE email IS NOT NULL
                """))
                db.session.execute(text("""
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
                    ON user (phone) WHERE phone IS NOT NULL
                """))
                db.session.commit()
                logging.info("创建唯一索引完成")
            except Exception as idx_e:
                logging.warning(f"创建唯一索引失败: {idx_e}")
                db.session.rollback()
            
            # 为现有用户设置验证状态
            existing_users = db.session.execute(
                text("SELECT id, username FROM user WHERE is_verified = 0 OR is_verified IS NULL")
            ).fetchall()
            
            if existing_users:
                logging.info(f"发现 {len(existing_users)} 个现有用户需要设置验证状态")
                
                current_time = datetime.datetime.utcnow().isoformat()
                db.session.execute(
                    text("UPDATE user SET is_verified = 1, verified_at = :time WHERE is_verified = 0 OR is_verified IS NULL"),
                    {"time": current_time}
                )
                db.session.commit()
                logging.info("现有用户验证状态设置完成")
            
            # 为现有用户设置默认积分
            users_without_credits = db.session.execute(
                text("SELECT id, username FROM user WHERE credits IS NULL")
            ).fetchall()
            
            if users_without_credits:
                logging.info(f"发现 {len(users_without_credits)} 个现有用户需要设置默认积分")
                
                db.session.execute(
                    text("UPDATE user SET credits = 30 WHERE credits IS NULL")
                )
                db.session.commit()
                logging.info("现有用户默认积分设置完成")
            
            # 清理过期的 OTP 码
            try:
                cleaned_count = OTPCode.cleanup_expired()
                if cleaned_count > 0:
                    logging.info(f"清理了 {cleaned_count} 个过期的验证码")
            except Exception:
                # OTP 表可能还不存在，忽略错误
                pass
            
            # 执行安全检查
            try:
                enforce_unique_constraints()
                disabled_count = disable_excessive_attempts()
                if disabled_count > 0:
                    logging.info(f"禁用了 {disabled_count} 个超限验证码")
                logging.info("安全检查完成")
            except Exception as sec_e:
                logging.warning(f"安全检查失败: {sec_e}")
                
    except Exception as e:
        logging.error(f"数据库迁移失败: {e}")
        db.session.rollback()

def init_database():
    """初始化数据库，如果需要的话"""
    try:
        # 检查数据库文件是否存在
        db_path = app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
        db_exists = os.path.exists(db_path)
        
        if not db_exists:
            logging.info("创建新数据库...")
            db.create_all()
            logging.info("数据库创建完成")
        else:
            logging.info("数据库已存在，执行迁移检查...")
            migrate_database()
            
    except Exception as e:
        logging.error(f"数据库初始化失败: {e}")

# ------------------------- 5. Flask API 接口 -------------------------

# --- 新增：用户认证API ---

@app.route('/register', methods=['POST'])
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

@app.route('/login', methods=['POST'])
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

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    """用户登出接口"""
    logging.info(f"用户登出: {current_user.username}")
    logout_user()
    return jsonify({'message': '登出成功'})

@app.route('/auth/login-password', methods=['POST'])
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

@app.route('/account/password/request-code', methods=['POST'])
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

@app.route('/account/password/update', methods=['POST'])
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

@app.route('/auth/password/forgot/request', methods=['POST'])
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

@app.route('/auth/password/forgot/confirm', methods=['POST'])
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

@app.route('/api/user/status', methods=['GET'])
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
            'has_password': bool(current_user.password_hash),
            'enable_paid_voices': os.environ.get('ENABLE_PAID_VOICES', 'true').lower() == 'true'
        })
    else:
        return jsonify({
            'isLoggedIn': False,
            'allow_password_login': ALLOW_PASSWORD_LOGIN,
            'enable_paid_voices': os.environ.get('ENABLE_PAID_VOICES', 'true').lower() == 'true'
        })

# --- 新增：邮箱绑定API ---

@app.route('/account/email/request-code', methods=['POST'])
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

@app.route('/account/email/verify', methods=['POST'])
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

@app.route('/auth/request-code', methods=['POST'])
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

@app.route('/auth/verify-code', methods=['POST'])
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

@app.route('/api/send-otp', methods=['POST'])
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

@app.route('/api/verify-otp', methods=['POST'])
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

@app.route('/api/register-with-otp', methods=['POST'])
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

@app.route('/generate-title', methods=['POST'])
@login_required
def generate_title_api():
    """API接口：为给定的脚本内容生成一个标题"""
    try:
        data = request.json
        script_content = data.get('script')
        if not script_content:
            return jsonify({"error": "脚本内容不能为空"}), 400
        
        # 注意：这里我们硬编码了模型，也可以从前端传递
        title = generate_title_with_gemini(script_content) 
        return jsonify({"title": title})

    except Exception as e:
        logging.error(f"/generate-title 接口出错: {e}", exc_info=True)
        return jsonify({"error": f"标题生成失败: {str(e)}"}), 500

# --- 新增：基于数据库的用户专属音色库 API ---

@app.route('/voices', methods=['GET'])
@login_required
def get_user_voices():
    """获取当前登录用户可用的音色列表（包括全站共享和个人音色），不再区分type"""
    
    # 获取全站共享音色（不再按type过滤）
    global_voices = Voice.query.filter_by(is_global=True).order_by(Voice.id.desc()).all()
    
    # 获取用户个人音色（不再按type过滤）
    personal_voices = Voice.query.filter_by(owner=current_user, is_global=False).order_by(Voice.id.desc()).all()
    
    # 将 SQLAlchemy 对象转换为字典列表
    voices_data = {
        'global_voices': [{
            'id': v.id,
            'name': v.name,
            'text': v.text,
            'audio_path': v.audio_path,
            'type': v.type,
            'description': v.description,
            'is_global': v.is_global,
            'owner_username': v.owner.username if v.owner else 'System',
            'preview_url': f"/api/voices/{v.id}/preview"
        } for v in global_voices],
        'personal_voices': [{
            'id': v.id,
            'name': v.name,
            'text': v.text,
            'audio_path': v.audio_path,
            'type': v.type,
            'description': v.description,
            'is_global': v.is_global,
            'owner_username': v.owner.username,
            'preview_url': f"/api/voices/{v.id}/preview"
        } for v in personal_voices]
    }
    
    return jsonify(voices_data)

@app.route('/voices', methods=['POST'])
@login_required
def add_user_voice():
    """为当前登录用户添加一个新音色（需要付费权限）"""
    try:
        # 检查用户是否有付费权限（管理员免检查）
        if not current_user.is_admin and not current_user.has_premium:
            return jsonify({'error': '添加个人音色需要升级到付费版本', 'premium_required': True}), 402
        
        if 'referenceAudio' not in request.files:
            return jsonify({'error': '缺少参考音频文件'}), 400
        
        voice_name = request.form.get('voiceName')
        reference_text = request.form.get('referenceText')
        voice_type = request.form.get('voiceType', 'single')  # 默认为single类型
        voice_description = request.form.get('voiceDescription', '')
        reference_audio = request.files['referenceAudio']
        
        # 单人音色自动修复：发现对话痕迹就净化
        if voice_type == 'single':
            original_text = reference_text
            reference_text = _autofix_single_voice_text(reference_text)
            if original_text != reference_text:
                logging.info(f"单人音色文本自动净化: '{voice_name}' - 原文: '{original_text}' -> 净化后: '{reference_text}'")

        if not all([voice_name, reference_text]):
            return jsonify({'error': '缺少必要参数'}), 400

        # 检查音色名称唯一性
        if current_user.is_admin:
            # 管理员检查全站共享音色名称唯一性
            if Voice.query.filter_by(name=voice_name, is_global=True).first():
                return jsonify({'error': f'全站共享音色名称 "{voice_name}" 已存在'}), 409
        else:
            # 普通用户检查个人音色名称唯一性
            if Voice.query.filter_by(owner=current_user, name=voice_name, is_global=False).first():
                return jsonify({'error': f'音色名称 "{voice_name}" 已存在'}), 409

        # 保存音频文件
        VOICES_AUDIO_DIR = Path('voices_audio/')
        if not VOICES_AUDIO_DIR.exists():
            VOICES_AUDIO_DIR.mkdir(exist_ok=True)
        
        ext = Path(reference_audio.filename).suffix or '.wav'
        audio_filename = f"{uuid.uuid4()}{ext}"
        audio_path = VOICES_AUDIO_DIR / audio_filename
        
        # 保存音频文件
        reference_audio.save(audio_path)
        
        # 验证文件是否保存成功
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            return jsonify({'error': '音频文件保存失败'}), 500
        
        logging.info(f"音频文件保存成功: {audio_path}, 大小: {audio_path.stat().st_size} bytes")
        
        # ✅ 新增：清洗参考音频（去掉首尾空气声，限制时长）
        clean_reference_wav(str(audio_path), str(audio_path))
        
        # 再次验证清洗后的文件
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            return jsonify({'error': '音频文件处理失败'}), 500

        # 创建新音色记录并存入数据库
        # 如果是管理员，默认创建全站共享音色
        new_voice = Voice(
            name=voice_name,
            text=reference_text,
            audio_path=str(audio_path),
            type=voice_type,
            description=voice_description,
            owner=current_user,
            is_global=current_user.is_admin,  # 管理员添加的音色自动设为全站共享
            source_model=SF_TTS_MODEL  # 设置源模型
        )
        db.session.add(new_voice)
        db.session.commit()

        # 尝试上传到SiliconFlow获取预置音色URI
        try:
            # 获取用户的API密钥
            user_api_keys = UserAPIKey.query.filter_by(user_id=current_user.id).first()
            if user_api_keys and user_api_keys.siliconflow_key:
                api_key = user_api_keys.siliconflow_key
                base_url = user_api_keys.siliconflow_base
            else:
                # 使用全局配置
                api_key = API_KEYS.get('siliconflow_key')
                base_url = API_KEYS.get('siliconflow_base')
            
            if api_key and base_url:
                voice_uri = upload_voice_to_siliconflow(new_voice, api_key, base_url)
                if voice_uri:
                    new_voice.voice_uri = voice_uri
                    db.session.commit()
                    logging.info(f"成功上传音色到SiliconFlow: {voice_name} -> {voice_uri}")
                else:
                    logging.warning(f"上传音色到SiliconFlow失败，将使用动态references: {voice_name}")
            else:
                logging.warning(f"未找到SiliconFlow API密钥，将使用动态references: {voice_name}")
        except Exception as upload_e:
            logging.error(f"上传音色到SiliconFlow异常: {upload_e}", exc_info=True)
            # 上传失败不影响音色创建，继续使用动态references

        logging.info(f"用户 '{current_user.username}' 添加了新音色: {voice_name}")
        return jsonify({'message': '音色保存成功'}), 201

    except Exception as e:
        db.session.rollback()
        logging.error(f"添加音色失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/voices/<int:voice_id>', methods=['PUT'])
@login_required
def update_user_voice(voice_id):
    """更新当前登录用户的指定音色"""
    voice = Voice.query.get_or_404(voice_id)
    
    # 权限检查：只能编辑自己的音色，或者管理员可以编辑全站共享音色
    if voice.owner != current_user and not (current_user.is_admin and voice.is_global):
        return jsonify({'error': '无权操作该音色'}), 403

    new_name = request.form.get('newName', '').strip()
    if new_name != voice.name and Voice.query.filter_by(owner=current_user, name=new_name).first():
        return jsonify({'error': f'音色名称 "{new_name}" 已存在'}), 409

    voice.name = new_name
    new_text = request.form.get('newText', '').strip()
    
    # 单人音色自动修复：发现对话痕迹就净化
    if voice.type == 'single':
        original_text = new_text
        new_text = _autofix_single_voice_text(new_text)
        if original_text != new_text:
            logging.info(f"单人音色文本自动净化: '{voice.name}' - 原文: '{original_text}' -> 净化后: '{new_text}'")
    
    voice.text = new_text
    voice.description = request.form.get('newDescription', '').strip()

    if 'newReferenceAudio' in request.files:
        new_audio_file = request.files['newReferenceAudio']
        if new_audio_file and new_audio_file.filename:
            # 删除旧音频文件
            try:
                old_audio_path = Path(voice.audio_path)
                if old_audio_path.exists():
                    old_audio_path.unlink()
            except Exception as e:
                logging.error(f"删除旧音频文件失败: {e}")
            
            # 保存新音频文件
            VOICES_AUDIO_DIR = Path('voices_audio/')
            if not VOICES_AUDIO_DIR.exists():
                VOICES_AUDIO_DIR.mkdir(exist_ok=True)
            
            ext = Path(new_audio_file.filename).suffix or '.wav'
            audio_filename = f"user_{current_user.id}_{uuid.uuid4()}{ext}"
            audio_path = VOICES_AUDIO_DIR / audio_filename
            new_audio_file.save(audio_path)
            
            # 更新数据库中的音频路径
            voice.audio_path = str(audio_path)
            
            # 音频文件更新后，重新上传到SiliconFlow获取新的voice_uri
            try:
                # 获取用户的API密钥
                user_api_keys = UserAPIKey.query.filter_by(user_id=current_user.id).first()
                if user_api_keys and user_api_keys.siliconflow_key:
                    api_key = user_api_keys.siliconflow_key
                    base_url = user_api_keys.siliconflow_base
                else:
                    # 使用全局配置
                    api_key = API_KEYS.get('siliconflow_key')
                    base_url = API_KEYS.get('siliconflow_base')
                
                if api_key and base_url:
                    voice_uri = upload_voice_to_siliconflow(voice, api_key, base_url)
                    if voice_uri:
                        voice.voice_uri = voice_uri
                        logging.info(f"成功重新上传音色到SiliconFlow: {voice.name} -> {voice_uri}")
                    else:
                        logging.warning(f"重新上传音色到SiliconFlow失败，将使用动态references: {voice.name}")
                else:
                    logging.warning(f"未找到SiliconFlow API密钥，将使用动态references: {voice.name}")
            except Exception as upload_e:
                logging.error(f"重新上传音色到SiliconFlow异常: {upload_e}", exc_info=True)
                # 上传失败不影响音色更新

    db.session.commit()
    logging.info(f"用户 '{current_user.username}' 更新了音色: {voice.name}")
    return jsonify({'message': '音色更新成功'})

@app.route('/voices/<int:voice_id>', methods=['DELETE'])
@login_required
def delete_user_voice(voice_id):
    """删除当前登录用户的指定音色"""
    voice = Voice.query.get_or_404(voice_id)
    
    # 权限检查：只能删除自己的音色，或者管理员可以删除全站共享音色
    if voice.owner != current_user and not (current_user.is_admin and voice.is_global):
        return jsonify({'error': '无权操作该音色'}), 403

    # 删除音频文件
    try:
        audio_file = Path(voice.audio_path)
        if audio_file.exists():
            audio_file.unlink()
    except Exception as e:
        logging.error(f"删除音频文件失败: {e}")
    
    db.session.delete(voice)
    db.session.commit()
    logging.info(f"用户 '{current_user.username}' 删除了音色: {voice.name}")
    return jsonify({'message': '音色删除成功'})

# --- 新增：管理员音色管理API ---

@app.route('/admin/voices', methods=['POST'])
@login_required
def add_global_voice():
    """管理员添加全站共享音色"""
    try:
        # 检查管理员权限
        if not current_user.is_admin:
            return jsonify({'error': '需要管理员权限'}), 403
        
        if 'referenceAudio' not in request.files:
            return jsonify({'error': '缺少参考音频文件'}), 400
        
        voice_name = request.form.get('voiceName')
        reference_text = request.form.get('referenceText')
        voice_type = request.form.get('voiceType', 'single')  # 默认为single类型
        voice_description = request.form.get('voiceDescription', '')
        reference_audio = request.files['referenceAudio']

        if not all([voice_name, reference_text]):
            return jsonify({'error': '缺少必要参数'}), 400

        # 检查全站音色名称唯一性
        if Voice.query.filter_by(name=voice_name, is_global=True).first():
            return jsonify({'error': f'全站共享音色名称 "{voice_name}" 已存在'}), 409

        # 保存音频文件
        VOICES_AUDIO_DIR = Path('voices_audio/')
        if not VOICES_AUDIO_DIR.exists():
            VOICES_AUDIO_DIR.mkdir(exist_ok=True)
        
        ext = Path(reference_audio.filename).suffix or '.wav'
        audio_filename = f"global_{uuid.uuid4()}{ext}"
        audio_path = VOICES_AUDIO_DIR / audio_filename
        
        # 保存音频文件
        reference_audio.save(audio_path)
        
        # 验证文件是否保存成功
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            return jsonify({'error': '音频文件保存失败'}), 500
        
        logging.info(f"音频文件保存成功: {audio_path}, 大小: {audio_path.stat().st_size} bytes")
        
        # ✅ 新增：清洗参考音频（去掉首尾空气声，限制时长）
        clean_reference_wav(str(audio_path), str(audio_path))
        
        # 再次验证清洗后的文件
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            return jsonify({'error': '音频文件处理失败'}), 500

        # 创建全站共享音色记录
        new_voice = Voice(
            name=voice_name,
            text=reference_text,
            audio_path=str(audio_path),
            type=voice_type,
            description=voice_description,
            owner=current_user,
            is_global=True  # 标记为全站共享
        )
        db.session.add(new_voice)
        db.session.commit()

        logging.info(f"管理员 '{current_user.username}' 添加了全站共享音色: {voice_name}")
        return jsonify({'message': '全站共享音色添加成功'}), 201

    except Exception as e:
        db.session.rollback()
        logging.error(f"添加全站共享音色失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/admin/voices/<int:voice_id>', methods=['PUT'])
@login_required
def update_global_voice(voice_id):
    """管理员更新全站共享音色"""
    try:
        # 检查管理员权限
        if not current_user.is_admin:
            return jsonify({'error': '需要管理员权限'}), 403
        
        voice = Voice.query.get_or_404(voice_id)
        if not voice.is_global:
            return jsonify({'error': '只能编辑全站共享音色'}), 403

        new_name = request.form.get('newName', '').strip()
        if new_name and new_name != voice.name:
            # 检查新名称是否已被其他全站音色使用
            if Voice.query.filter_by(name=new_name, is_global=True).filter(Voice.id != voice_id).first():
                return jsonify({'error': f'音色名称 "{new_name}" 已存在'}), 409
            voice.name = new_name

        voice.text = request.form.get('newText', voice.text).strip()
        voice.description = request.form.get('newDescription', voice.description).strip()

        if 'newReferenceAudio' in request.files:
            new_audio_file = request.files['newReferenceAudio']
            if new_audio_file.filename:
                # 删除旧音频文件
                try:
                    old_audio_path = Path(voice.audio_path)
                    if old_audio_path.exists():
                        old_audio_path.unlink()
                except Exception as e:
                    logging.warning(f"删除旧音频文件失败: {e}")
                
                # 保存新音频文件
                ext = Path(new_audio_file.filename).suffix or '.wav'
                audio_filename = f"global_{uuid.uuid4()}{ext}"
                audio_path = Path('voices_audio/') / audio_filename
                new_audio_file.save(audio_path)
                voice.audio_path = str(audio_path)

        db.session.commit()
        logging.info(f"管理员 '{current_user.username}' 更新了全站共享音色: {voice.name}")
        return jsonify({'message': '全站共享音色更新成功'})

    except Exception as e:
        db.session.rollback()
        logging.error(f"更新全站共享音色失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/admin/voices/<int:voice_id>', methods=['DELETE'])
@login_required
def delete_global_voice(voice_id):
    """管理员删除全站共享音色"""
    try:
        # 检查管理员权限
        if not current_user.is_admin:
            return jsonify({'error': '需要管理员权限'}), 403
        
        voice = Voice.query.get_or_404(voice_id)
        if not voice.is_global:
            return jsonify({'error': '只能删除全站共享音色'}), 403

        # 删除音频文件
        try:
            audio_file = Path(voice.audio_path)
            if audio_file.exists():
                audio_file.unlink()
        except Exception as e:
            logging.error(f"删除音频文件失败: {e}")
        
        voice_name = voice.name
        db.session.delete(voice)
        db.session.commit()
        
        logging.info(f"管理员 '{current_user.username}' 删除了全站共享音色: {voice_name}")
        return jsonify({'message': '全站共享音色删除成功'})

    except Exception as e:
        db.session.rollback()
        logging.error(f"删除全站共享音色失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/admin/voices', methods=['GET'])
@login_required
def get_admin_voices():
    """管理员获取所有音色列表（用于管理界面）"""
    try:
        # 检查管理员权限
        if not current_user.is_admin:
            return jsonify({'error': '需要管理员权限'}), 403
        
        # 获取全站共享音色（不再按type过滤）
        global_voices = Voice.query.filter_by(is_global=True).order_by(Voice.id.desc()).all()
        
        # 获取用户个人音色统计（可选）
        personal_voices_count = Voice.query.filter_by(is_global=False).count()
        
        voices_data = {
            'global_voices': [{
                'id': v.id,
                'name': v.name,
                'text': v.text,
                'audio_path': v.audio_path,
                'type': v.type,
                'description': v.description,
                'is_global': v.is_global,
                'owner_username': v.owner.username,
                'created_at': v.id,  # 使用ID作为创建顺序的简单指示
                'preview_url': f"/api/voices/{v.id}/preview"
            } for v in global_voices],
            'stats': {
                'global_voices_count': len(global_voices),
                'personal_voices_count': personal_voices_count
            }
        }
        
        return jsonify(voices_data)

    except Exception as e:
        logging.error(f"获取管理员音色列表失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# --- 新增：音色试听预览 API ---



@app.get("/api/voices/<int:voice_id>/preview")
@login_required
def voice_preview(voice_id: int):
    """直接播放上传的音频文件作为预览"""
    from werkzeug.exceptions import Forbidden
    
    v = Voice.query.get_or_404(voice_id)

    # 权限：本人/全站共享/管理员可播
    if not (v.user_id == current_user.id or v.is_global or current_user.is_admin):
        raise Forbidden("no permission to preview this voice")

    try:
        # 首先检查原始音频文件是否存在
        original_path = Path(v.audio_path)
        if not original_path.exists():
            logging.error(f"音色 {voice_id} 的音频文件不存在: {v.audio_path}")
            return jsonify({"error": "音频文件不存在，请重新上传"}), 404
        
        if original_path.stat().st_size == 0:
            logging.error(f"音色 {voice_id} 的音频文件为空: {v.audio_path}")
            return jsonify({"error": "音频文件损坏，请重新上传"}), 404
        
        preview_path = ensure_preview_file(v)  # 关键：用上传文件做预览源
    except FileNotFoundError:
        logging.error(f"音色 {voice_id} 预览文件生成失败: {v.audio_path}")
        return jsonify({"error": "预览音频生成失败"}), 404
    except Exception as e:
        logging.error(f"音色 {voice_id} 预览处理失败: {e}", exc_info=True)
        return jsonify({"error": "预览处理失败"}), 500

    # 根据文件扩展名设置正确的MIME类型，支持更多音频格式
    suffix = preview_path.suffix.lower()
    if suffix == '.mp3':
        mimetype = "audio/mpeg"
    elif suffix == '.wav':
        mimetype = "audio/wav"
    elif suffix in ['.m4a', '.mp4']:
        mimetype = "audio/mp4"
    elif suffix == '.ogg':
        mimetype = "audio/ogg"
    elif suffix == '.flac':
        mimetype = "audio/flac"
    elif suffix == '.aac':
        mimetype = "audio/aac"
    elif suffix == '.webm':
        mimetype = "audio/webm"
    elif suffix == '.opus':
        mimetype = "audio/opus"
    else:
        # 对于未知格式，使用通用的二进制流类型，让浏览器自动检测
        mimetype = "application/octet-stream"
    
    # 禁用Range请求以避免416错误，直接返回完整文件
    response = send_file(
        preview_path,
        mimetype=mimetype,
        as_attachment=False,
        conditional=False,  # 禁用Range请求
        download_name=preview_path.name
    )
    
    # 添加HTTP头来确保浏览器正确处理音频文件
    response.headers['Accept-Ranges'] = 'none'  # 禁用Range请求
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    
    # 对于某些格式，添加额外的头信息
    if suffix in ['.wav', '.flac']:
        response.headers['Content-Type'] = mimetype + '; charset=binary'
    
    return response


# --- 新增：基于数据库的用户专属历史记录 API ---

@app.route('/history', methods=['GET'])
@login_required
def get_user_history():
    """获取当前登录用户的历史记录，按时间倒序"""
    history_items = History.query.filter_by(user_id=current_user.id).order_by(History.timestamp.desc()).all()
    
    history_data = [{
        'id': h.id,
        'title': h.title,
        'script_full': h.script_full, # 注意：未来可能优化为仅传预览
        'audio_filename': h.audio_filename,
        'timestamp': h.timestamp.isoformat(),
        'mode': h.mode,
        'voice_name': h.voice_name,
        'duration': h.duration,
        'play_count': h.play_count,
        'thumbnail_filename': h.thumbnail_filename,
        # 新增：原始输入字段
        'original_input': h.original_input,
        'input_type': h.input_type,
        # 新增：首音到达时间指标
        'speech_onset_ms': h.speech_onset_ms or 0
    } for h in history_items]
    
    resp = jsonify(history_data)
    resp.headers['Cache-Control'] = 'no-store'
    return resp

@app.route('/history/<string:history_id>', methods=['DELETE'])
@login_required
def delete_user_history(history_id):
    """删除当前登录用户的指定历史记录"""
    history_item = History.query.get_or_404(history_id)
    if history_item.user_id != current_user.id:
        return jsonify({'error': '无权操作该记录'}), 403

    # 删除音频文件
    try:
        audio_file = HISTORY_AUDIO_DIR / history_item.audio_filename
        if audio_file.exists():
            audio_file.unlink()
    except Exception as e:
        logging.error(f"删除历史音频文件失败: {e}")

    db.session.delete(history_item)
    db.session.commit()
    logging.info(f"用户 '{current_user.username}' 删除了历史记录: {history_item.title}")
    return jsonify({'message': '历史记录删除成功'})

@app.route('/history/play/<string:history_id>', methods=['POST'])
@login_required
def increment_play_count(history_id):
    """增加指定历史记录的播放次数"""
    history_item = History.query.get_or_404(history_id)
    if history_item.user_id != current_user.id:
         return jsonify({'error': '无权操作'}), 403
    
    history_item.play_count = (history_item.play_count or 0) + 1
    db.session.commit()
    return jsonify({'play_count': history_item.play_count})

@app.route('/history/update_duration/<string:history_id>', methods=['POST'])
@login_required
def update_history_duration(history_id):
    """更新历史记录的音频时长"""
    data = request.get_json()
    duration = data.get('duration')
    if not duration or not isinstance(duration, (int, float)):
        return jsonify({'error': '无效的时长'}), 400

    history_item = History.query.get_or_404(history_id)
    if history_item.user_id != current_user.id:
        return jsonify({'error': '无权操作'}), 403

    history_item.duration = duration
    db.session.commit()
    return jsonify({'message': '时长更新成功'})

@app.route('/api/history/<string:hid>', methods=['GET'])
@login_required
def api_history_detail(hid):
    """获取单条历史详情"""
    h = History.query.filter_by(id=hid, user_id=current_user.id).first()
    if not h:
        return jsonify({"ok": False, "error": "NOT_FOUND"}), 404
    data = {
        "id": h.id,
        "title": h.title,
        "script_full": h.script_full or "",
        "audio_filename": h.audio_filename,
        "timestamp": h.timestamp.isoformat() if h.timestamp else None,
        "mode": h.mode,
        "voice_name": h.voice_name,
        "duration": h.duration,
        "play_count": h.play_count,
        "thumbnail_filename": h.thumbnail_filename,
        "source_url": h.source_url,
        "source_title": h.source_title,
        "source_type": h.source_type,
        # 新增：首音到达时间指标
        "speech_onset_ms": h.speech_onset_ms or 0,
        # 新增：原始输入字段
        "original_input": h.original_input,
        "input_type": h.input_type
    }
    return jsonify({"ok": True, "data": data})


def _normalize_dialogue_tags(s: str) -> str:
    """规范化对话标签，将各种格式统一为 [S1]/[S2] 格式"""
    import re
    if not s:
        return ''
    
    lines = []
    for line in s.replace('\r\n', '\n').split('\n'):
        t = line.strip()
        if not t:
            lines.append('')
            continue
            
        # 匹配各种格式的说话人标签
        m = re.match(r'^\s*\[?\s*S\s*([12])\s*\]?\s*[:：、.\-]?\s*', t, flags=re.I)
        if m:
            # 提取标签后的内容
            content_after_tag = t[m.end():]
            # 重新构造为标准格式
            t = f'[S{m.group(1)}]' + content_after_tag
        lines.append(t)
    
    fixed = '\n'.join(lines)
    # 去重标签 [S1][S1] → [S1]
    fixed = re.sub(r'\[S([12])\]\s*\[S\1\]\s*', r'[S\1] ', fixed)
    return fixed

@app.route('/synthesize-audio', methods=['POST'])
@login_required
def synthesize_audio_api():
    """核心功能：调用SiliconFlow API合成音频，并为当前用户创建一条历史记录"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求体不能为空"}), 400
            
        script_content = data.get('script')
        # 后端兜底再规范化：即使前端已修，后端入口也做一次规范化
        script_content = _normalize_dialogue_tags(script_content)
        
        # 健壮性检查：脚本经一次规范化后如果还是空，直接报错
        if not script_content or not script_content.strip():
            return jsonify({"error": "脚本为空"}), 400
        
        # 新的音色参数：优先使用ID，向后兼容名称
        mode = data.get('mode')
        title = data.get('title')
        
        # 获取音色ID（只使用ID，禁止兜底用名字）
        voice_id = data.get('voice_id')
        s1_voice_id = data.get('s1_voice_id')
        s2_voice_id = data.get('s2_voice_id')
        
        # 单人模式：强制上 [S1] 标签，确保与 references 同构
        if mode == 'single':
            script_content = ensure_single_tagging(script_content)
            # 兜底：把任何 S2 痕迹替换为 S1（非行首也处理）
            script_content = re.sub(r'\[S2\]', '[S1]', script_content)
        
        # 新增：获取原始输入内容
        original_input = data.get('originalInput') or data.get('script')
        input_type = data.get('inputType') or 'manual'
        source_url = data.get('sourceUrl') or ''
        source_title = data.get('sourceTitle') or ''
        
        # 参数验证：根据模式检查必要参数
        if mode == 'role':
            # 对话模式使用双音色
            if not all([script_content, s1_voice_id, s2_voice_id, mode]):
                return jsonify({"error": "缺少必要参数：script, s1_voice_id, s2_voice_id, mode"}), 400
        else:
            # 单人模式使用单个音色
            if not all([script_content, voice_id, mode]):
                return jsonify({"error": "缺少必要参数：script, voice_id, mode"}), 400

        # 1. 获取用户专属的API密钥
        user_api_keys = UserAPIKey.query.filter_by(user_id=current_user.id).first()
        if not user_api_keys or not user_api_keys.siliconflow_key:
            # This is a placeholder. We will soon build a UI for users to set their keys.
            # For now, we fall back to the globally configured key for testing.
            if not API_KEYS.get('siliconflow_key'):
                 return jsonify({"error": "未找到可用的SiliconFlow API密钥"}), 400
            siliconflow_key = API_KEYS.get('siliconflow_key')
            siliconflow_base = API_KEYS.get('siliconflow_base')
        else:
            siliconflow_key = user_api_keys.siliconflow_key
            siliconflow_base = user_api_keys.siliconflow_base

        # --- 新增：如果标题不存在，则自动生成 ---
        if not title or title == '无标题播客':
            logging.info("未提供标题，正在调用 Gemini 自动生成标题...")
            try:
                gemini_client = get_gemini_client()
                # 截取前1000个字符用于总结，以提高效率和节省成本
                script_for_summary = script_content[:1000] 
                
                summarize_prompt = f"请为以下播客脚本提炼一个15字以内的、引人入-胜的短标题。只返回标题本身，不要包含任何多余的符号或文字，例如【标题】或引号。\n\n脚本内容：\n{script_for_summary}"
                
                completion = gemini_client.chat.completions.create(
                    model="gemini-1.5-flash", # 使用一个快速、经济的模型来生成标题
                    messages=[
                        {"role": "user", "content": summarize_prompt}
                    ],
                    temperature=0.7
                )
                generated_title = completion.choices[0].message.content.strip()
                # 清理可能的引号和特殊标记
                title = generated_title.strip().strip('"“"【】：标题')
                logging.info(f"成功生成标题: {title}")
            except Exception as title_e:
                logging.error(f"自动生成标题失败: {title_e}")
                title = "AI生成的播客" # 如果生成失败，使用一个通用标题
        # --- 结束新增逻辑 ---

        # 2. 获取音色对象并验证权限
        voices = []
        voice_names_for_log = []
        
        if mode == 'role':
            # 对话模式：获取两个音色
            voice1 = get_voice_by_id_or_403(s1_voice_id)
            voice2 = get_voice_by_id_or_403(s2_voice_id)
            voices = [voice1, voice2]
            voice_names_for_log = [voice1.name, voice2.name]
        else:
            # 单人模式：获取一个音色
            voice = get_voice_by_id_or_403(voice_id)
            voices = [voice]
            voice_names_for_log = [voice.name]
        
        reference_segments = _collect_reference_segments(voices)

        # 3. 初始化SiliconFlow客户端
        sf_client = OpenAI(api_key=siliconflow_key, base_url=siliconflow_base)

        # 准备文件和目录
        history_id = str(uuid.uuid4())
        save_fmt = "mp3"
        audio_filename = f"history_{history_id}.{save_fmt}"
        audio_path = HISTORY_AUDIO_DIR / audio_filename
        
        # 记录使用的音色信息
        if mode == 'role':
            logging.info(f"用户 '{current_user.username}' 开始合成音频，使用双音色: {voice_names_for_log[0]} (S1), {voice_names_for_log[1]} (S2)")
        else:
            logging.info(f"用户 '{current_user.username}' 开始合成音频，使用音色: {voice_names_for_log[0]}")

        # 3.5. 检查用户积分余额
        if (current_user.credits or 0) < CREDITS_PER_AUDIO:
            return jsonify({
                "error": "积分不足",
                "required": CREDITS_PER_AUDIO,
                "current": current_user.credits or 0,
                "payment_required": True
            }), 402

        # 4. 调用SiliconFlow API进行音频合成
        # 优先使用预置音色URI，降级到动态references
        actual_voice_id_used = None
        actual_voice_uri_used = None
        
        try:
            if USE_MOSS_TTSD:
                # MOSS-TTSD 路径（保留，通过 USE_MOSS_TTSD=true 手动开启）
                logging.info("使用 MOSS-TTSD 模式进行音频合成")
                audio_data = tts_with_moss_references(script_content, voices, mode, sf_client)
                actual_voice_id_used = voices[0].id
                actual_voice_uri_used = None
            else:
                # CosyVoice2 路径：按说话人分段合成，自动上传音色拿 speech:xxx URI
                logging.info(f"使用 CosyVoice2 分段合成 | mode={mode} | voices={[v.name for v in voices]}")
                audio_data = tts_cosyvoice_per_turn(
                    script_content, voices, mode, sf_client,
                    siliconflow_key, siliconflow_base
                )
                actual_voice_id_used = voices[0].id
                actual_voice_uri_used = voices[0].voice_uri
                
        except Exception as tts_e:
            logging.error(f"TTS合成失败: {tts_e}", exc_info=True)
            return jsonify({"error": f"音频合成失败: {str(tts_e)}"}), 500

        # 5. 音频保存
        # CosyVoice2 路径：audio_data 已是完整 MP3，直接写入，不做二次后处理。
        # MOSS-TTSD 路径同理，TTS_ENABLE_POSTPROCESS=1 时才启用 finalize_tts_output。
        speech_onset_ms = 0
        if not USE_MOSS_TTSD or os.getenv("TTS_ENABLE_POSTPROCESS", "0") != "1":
            with open(audio_path, "wb") as f:
                f.write(audio_data)
        else:
            try:
                processed_bytes, speech_onset_ms = finalize_tts_output(
                    audio_data,
                    src_format=SF_TTS_FORMAT,
                    target_format="mp3",
                    reference_segments=reference_segments
                )
                with open(audio_path, "wb") as f:
                    f.write(processed_bytes)
            except Exception as pp_e:
                logging.warning(f"后处理失败，直接写入原始音频: {pp_e}")
                with open(audio_path, "wb") as f:
                    f.write(audio_data)
        
        logging.info(f"音频文件已保存至: {audio_path}")

        # 保存后：片头抓取（首音过慢时导出片头供比对）
        if speech_onset_ms is not None and speech_onset_ms > 500:
            try:
                debug_dir = Path("debug_heads")
                debug_dir.mkdir(parents=True, exist_ok=True)
                seg_full = AudioSegment.from_file(audio_path)
                seg_full[:2000].export(debug_dir / f"{Path(audio_path).stem}_head2s.mp3",
                                       format="mp3", bitrate="128k")
                logging.warning(f"⚠️ 首音达到 {speech_onset_ms}ms，已导出片头2s到 {debug_dir}")
            except Exception as _e:
                logging.warning(f"导出片头2s失败：{_e}")

        # 6. 计算音频时长 - 双保险逻辑，确保获取到可信时长
        duration_in_seconds = None
        try:
            # 优先尝试 mutagen
            audio = File(audio_path)
            if audio and audio.info:
                duration_in_seconds = audio.info.length
                logging.info(f"使用 mutagen 获取到原始时长: {duration_in_seconds} 秒")
        except Exception as e:
            logging.warning(f"Mutagen 获取时长失败: {e}，尝试使用 pydub 作为备用方案。")
            try:
                # Mutagen 失败后，尝试 pydub
                audio_segment = AudioSegment.from_file(audio_path)
                duration_in_seconds = len(audio_segment) / 1000.0  # pydub 以毫秒为单位
                logging.info(f"使用 pydub 获取到原始时长: {duration_in_seconds} 秒")
            except Exception as e2:
                logging.error(f"Pydub 获取时长也失败了: {e2}", exc_info=True)
                duration_in_seconds = 0
        
        # 兜底检查：确保时长不为 0/None
        if not duration_in_seconds or duration_in_seconds <= 0:
            logging.error(f"音频时长获取失败，文件路径: {audio_path}")
            # 尝试使用 ffprobe 作为最后的备用方案
            try:
                import subprocess
                result = subprocess.run([
                    'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
                    '-of', 'csv=p=0', str(audio_path)
                ], capture_output=True, text=True, timeout=10)
                if result.returncode == 0 and result.stdout.strip():
                    duration_in_seconds = float(result.stdout.strip())
                    logging.info(f"使用 ffprobe 获取到原始时长: {duration_in_seconds} 秒")
                else:
                    raise Exception("ffprobe 命令执行失败")
            except Exception as ffprobe_e:
                logging.error(f"ffprobe 获取时长也失败了: {ffprobe_e}")
                # 如果所有方法都失败，设置一个默认值并记录警告
                duration_in_seconds = 30  # 默认30秒
                logging.warning(f"所有时长获取方法都失败，使用默认时长: {duration_in_seconds} 秒")
        
        logging.info(f"最终确定的音频时长: {duration_in_seconds} 秒")

        # 随机选择一个缩略图
        THUMBNAIL_DIR = Path('static/card-thumbnail/')
        thumbnail_image = None
        if THUMBNAIL_DIR.exists():
            thumbnail_files = [f.name for f in THUMBNAIL_DIR.glob('*.jpg')] + [f.name for f in THUMBNAIL_DIR.glob('*.png')]
            if thumbnail_files:
                thumbnail_image = random.choice(thumbnail_files)

        # 7. 创建历史记录并原子化扣分（在同一事务中完成）
        # 确定保存的音色名称
        if mode == 'role':
            # 对话模式：保存双音色信息
            saved_voice_name = f"{voice_names_for_log[0]} + {voice_names_for_log[1]}"
        else:
            # 单人模式：保存单个音色名称
            saved_voice_name = voice_names_for_log[0]
            
        new_history_entry = History(
            id=history_id,
            user_id=current_user.id,
            title=title,
            script_full=script_content,
            audio_filename=audio_filename,
            timestamp=datetime.datetime.utcnow(),
            mode=mode,
            voice_name=saved_voice_name,
            duration=duration_in_seconds,
            play_count=0,
            thumbnail_filename=thumbnail_image,
            # 新增：保存原始输入信息
            original_input=original_input,
            input_type=input_type,
            # 新增：保存来源信息
            source_url=source_url,
            source_title=source_title,
            source_type=input_type,  # 使用input_type作为source_type
            # 新增：首音到达时间指标
            speech_onset_ms=speech_onset_ms,
            # 新增：音色溯源字段
            voice_id_used=actual_voice_id_used,
            voice_uri_used=actual_voice_uri_used,
            owner=current_user
        )
        db.session.add(new_history_entry)
        
        # 原子化扣分：在同一事务中扣除用户积分
        current_user.credits = (current_user.credits or 0) - CREDITS_PER_AUDIO
        
        # 提交事务：如果任一步失败则回滚，不扣分不落库
        db.session.commit()

        logging.info(f"为用户 '{current_user.username}' 成功创建历史记录并扣除 {CREDITS_PER_AUDIO} 积分，剩余积分: {current_user.credits}")

        # 8. 返回与前端兼容的数据
        return jsonify({
            'id': new_history_entry.id,
            'title': new_history_entry.title,
            'script_full': new_history_entry.script_full,
            'audio_filename': new_history_entry.audio_filename,
            'timestamp': new_history_entry.timestamp.isoformat(),
            'mode': new_history_entry.mode,
            'voice_name': new_history_entry.voice_name,
            'duration': new_history_entry.duration,
            'play_count': new_history_entry.play_count,
            'thumbnail_filename': new_history_entry.thumbnail_filename,
            # 新增：返回原始输入信息
            'original_input': new_history_entry.original_input,
            'input_type': new_history_entry.input_type,
            # 新增：返回来源信息
            'source_url': new_history_entry.source_url,
            'source_title': new_history_entry.source_title,
            'source_type': new_history_entry.source_type,
            # 新增：返回首音到达时间指标
            'speech_onset_ms': new_history_entry.speech_onset_ms or 0,
            # 新增：返回最新积分余额，便于前端立即更新
            'credits': current_user.credits
        })

    except Exception as e:
        db.session.rollback()
        logging.error(f"音频合成API出错: {e}", exc_info=True)
        return jsonify({"error": f"音频合成失败: {str(e)}"}), 500

@app.route('/')
@login_required
def index():
    """返回前端主页"""
    return send_from_directory('.', 'index.html')

@app.route('/login', methods=['GET'])
def login_page():
    """渲染登录页面"""
    return send_from_directory('templates', 'login.html')

@app.route('/register', methods=['GET'])
def register_page():
    """渲染注册页面"""
    return send_from_directory('templates', 'register.html')

@app.route('/history_audio/<path:filename>')
@login_required
def serve_history_audio(filename):
    """为登录用户安全地提供历史记录音频文件"""
    # 额外的安全检查（可选但推荐）：可以验证该用户是否有权访问此文件
    # 为简化，我们暂时只依赖 @login_required
    return send_from_directory('history_audio', filename)

@app.route('/pdf_storage/<path:filename>')
@login_required
def serve_pdf_file(filename):
    """为登录用户安全地提供PDF文件"""
    # 安全检查：确保文件名格式正确
    if not filename.endswith('.pdf') or '..' in filename:
        return jsonify({"error": "无效的文件名"}), 400
    
    # 检查文件是否存在
    pdf_path = PDF_STORAGE_DIR / filename
    if not pdf_path.exists():
        return jsonify({"error": "PDF文件不存在"}), 404
    
    # 返回PDF文件
    return send_from_directory('pdf_storage', filename, mimetype='application/pdf')

@app.route('/test_api_response.html')
def test_api_page():
    """测试API响应页面"""
    return send_from_directory('.', 'test_api_response.html')

@app.route('/<path:path>')
def static_files(path):
    """处理静态文件请求（CSS、JS等）"""
    return send_from_directory('static', path)

# API密钥保存接口已移除，保留注释以便后续开发

@app.route("/api/extract_from_url", methods=["POST"])
def extract_from_url():
    """稳健的通用URL抽取接口"""
    data = request.get_json(force=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "缺少 url"}), 400

    # 抓取
    fetch = smart_fetch_html(url)
    if not fetch.get("ok"):
        # 精细错误类型映射
        error_map = {
            "ANTIBOT": "该链接可能启用了反爬/人机验证，暂无法解析",
            "UNSUPPORTED_MIME": "该链接不是标准网页（可能是文件/媒体），无法解析正文",
            "NETWORK_ERROR": "网络异常或目标站点无响应",
        }
        msg = error_map.get(fetch.get("error_type"), "解析失败")
        return jsonify({
            "ok": False,
            "error": msg,
            "error_type": fetch.get("error_type"),
            "resolved_url": fetch.get("url"),
            "strategy": fetch.get("strategy"),
            "status": fetch.get("status"),
        }), 422

    html = fetch["html"]
    text = extract_text_from_html(html, mirrored=fetch["mirrored"])

    if len(text) < MIN_ARTICLE_CHARS:
        # 进一步判断是否登录/付费提示
        lower = html.lower()
        if any(s in lower for s in ["subscribe to", "sign in", "log in", "members only", "paywall"]):
            err = "该链接内容可能需要登录/订阅，无法获取正文"
            et = "LOGIN_OR_PAYWALL"
        else:
            err = "未能可靠提取正文（内容过短或结构异常）"
            et = "CONTENT_TOO_SHORT"
        return jsonify({
            "ok": False,
            "error": err,
            "error_type": et,
            "resolved_url": fetch["url"],
            "strategy": fetch["strategy"],
        }), 422

    # 补充标题（仅直连 HTML 时可解析；镜像无 DOM）
    title = ""
    if not fetch["mirrored"]:
        try:
            soup = BeautifulSoup(html, "html.parser")
            title = extract_title(soup)
        except Exception:
            title = ""

    # 限长（避免把超长正文全塞给模型）
    max_chars = 20000
    if len(text) > max_chars:
        text = text[:max_chars]

    return jsonify({
        "ok": True,
        "resolved_url": fetch["url"],
        "title": title,
        "text": text,
        "word_count": len(text),
        "strategy": fetch["strategy"],  # direct / mirror
    })

@app.route('/generate-script', methods=['POST'])
@login_required
def generate_script_api():
    """API接口：生成播客脚本 - 支持PDF、URL和纯文本输入"""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "请求体不能为空"}), 400
            
        input_type = data.get('inputType')
        content = data.get('content')
        mode = data.get('mode')
        model = data.get('geminiModel')
        # duration参数已移除，不再需要
        
        # 新增：风格和长度参数
        style_key = data.get('styleKey')
        length_mode = data.get('lengthMode')  # 'concise' or 'detailed'
        
        # 默认值：对话=interview，单人=edu；长度默认精简
        if not style_key:
            style_key = 'interview' if mode == 'role' else 'edu'
        if length_mode not in ('concise', 'detailed'):
            length_mode = 'concise'

        if not all([input_type, content, mode, model]):
            return jsonify({"error": "缺少必要参数：inputType, content, mode, geminiModel"}), 400

        # 根据输入类型处理内容
        extracted_text = ""
        
        if input_type == 'pdf':
            try:
                # 解码Base64内容
                pdf_data = base64.b64decode(content)
                
                # 生成唯一的PDF文件名
                pdf_filename = f"pdf_{uuid.uuid4()}.pdf"
                pdf_path = PDF_STORAGE_DIR / pdf_filename
                
                # 保存PDF文件到存储目录
                with open(pdf_path, 'wb') as pdf_file:
                    pdf_file.write(pdf_data)
                
                try:
                    # 使用PyMuPDF提取文本
                    doc = fitz.open(pdf_path)
                    extracted_text = ""
                    for page_num in range(len(doc)):
                        page = doc.load_page(page_num)
                        extracted_text += page.get_text()
                    doc.close()
                    
                    if not extracted_text.strip():
                        # 删除无效的PDF文件
                        if pdf_path.exists():
                            pdf_path.unlink()
                        return jsonify({"error": "PDF文件中未找到可提取的文本内容"}), 400
                    
                    # 设置提取的文本，继续处理
                    extracted_text = extracted_text
                        
                except Exception as e:
                    # 如果文本提取失败，删除PDF文件
                    if pdf_path.exists():
                        pdf_path.unlink()
                    raise e
                    
            except Exception as e:
                logging.error(f"PDF处理失败: {e}")
                return jsonify({"error": f"PDF处理失败: {str(e)}"}), 500
                
        elif input_type == 'url':
            # 使用新的稳健URL抽取系统
            try:
                fetch = smart_fetch_html(content)
                if not fetch.get("ok"):
                    # 精细错误类型映射
                    error_map = {
                        "ANTIBOT": "该链接可能启用了反爬/人机验证，暂无法解析",
                        "UNSUPPORTED_MIME": "该链接不是标准网页（可能是文件/媒体），无法解析正文",
                        "NETWORK_ERROR": "网络异常或目标站点无响应",
                    }
                    msg = error_map.get(fetch.get("error_type"), "解析失败")
                    return jsonify({"error": msg, "error_type": fetch.get("error_type")}), 400

                html = fetch["html"]
                extracted_text = extract_text_from_html(html, mirrored=fetch["mirrored"])

                if len(extracted_text) < MIN_ARTICLE_CHARS:
                    # 进一步判断是否登录/付费提示
                    lower = html.lower()
                    if any(s in lower for s in ["subscribe to", "sign in", "log in", "members only", "paywall"]):
                        return jsonify({"error": "该链接内容可能需要登录/订阅，无法获取正文", "error_type": "LOGIN_OR_PAYWALL"}), 400
                    else:
                        return jsonify({"error": "未能可靠提取正文（内容过短或结构异常）", "error_type": "CONTENT_TOO_SHORT"}), 400

                # 限长（避免把超长正文全塞给模型）
                max_chars = 20000
                if len(extracted_text) > max_chars:
                    extracted_text = extracted_text[:max_chars]
                    
            except Exception as e:
                logging.error(f"URL内容解析失败: {e}")
                return jsonify({"error": "URL内容解析失败，请确保URL有效且包含可提取的文本", "error_type": "NETWORK_ERROR"}), 400
                
        elif input_type == 'text':
            # 直接使用纯文本内容
            extracted_text = content.strip()
            if not extracted_text:
                return jsonify({"error": "文本内容不能为空"}), 400
        else:
            return jsonify({"error": "不支持的输入类型，请使用 'pdf', 'url' 或 'text'"}), 400

        # 硬护栏：验证正文抽取是否成功（仅对URL/PDF生效）
        if input_type in ('url', 'pdf') and len(extracted_text.strip()) < MIN_ARTICLE_CHARS:
            return jsonify({"error": "正文抽取失败，已中止生成", "error_type": "CONTENT_TOO_SHORT"}), 422

        # 调用Gemini生成脚本
        title, script = create_podcast_script_with_gemini(
            extracted_text, mode, model, style_key=style_key, length_mode=length_mode
        )
        
        # 如果是PDF类型，返回PDF文件信息
        if input_type == 'pdf':
            return jsonify({
                "title": title, 
                "script": script,
                "pdf_filename": pdf_filename,
                "pdf_path": str(pdf_path)
            })
        else:
            return jsonify({"title": title, "script": script})

    except Exception as e:
        logging.error(f"/generate-script 接口出错: {e}", exc_info=True)
        return jsonify({"error": f"脚本生成失败: {str(e)}"}), 500


# ==================== 支付系统接口 ====================

# ===== Stripe 接入 =====
# import stripe
# stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

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
        with app.app_context():
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
                app.logger.info(f"成功添加数据库字段: {alter_sql}")
    except Exception as e:
        app.logger.warning(f"添加数据库字段失败: {e}")

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
        app.logger.error(f"❌ Stripe 配置缺失: {missing_vars}")
        app.logger.error("请在 .env.local 中设置这些环境变量")
        return False
    
    # 验证价格 ID 格式
    for plan, price_id in PRICE_MAP.items():
        if not price_id or not price_id.startswith('price_'):
            app.logger.error(f"❌ 无效的价格 ID: {plan}={price_id}")
            return False
    
    app.logger.info("✅ Stripe 配置验证通过")
    return True

def _add_credits(user, amount, reason=""):
    if amount and amount > 0:
        user.credits = (user.credits or 0) + int(amount)
        db.session.commit()
        app.logger.info(f"[credits] +{amount} to user {user.id} ({reason}) => {user.credits}")

@app.route('/api/billing/checkout', methods=['POST'])
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
        app.logger.info(f"收到支付请求: plan={plan}, 用户={current_user.id}")
        app.logger.info(f"当前 PRICE_MAP: {PRICE_MAP}")
        
        price_id = PRICE_MAP.get(plan)
        if not price_id:
            app.logger.error(f"未找到价格配置: plan={plan}")
            return jsonify({'ok': False, 'error': f'无效的产品/价格: {plan}'}), 400

        app.logger.info(f"使用价格 ID: {price_id}")
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
        
        app.logger.info(f"构建的 success_url: {success_url}")

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
        app.logger.exception("Stripe API 错误")
        msg = getattr(e, 'user_message', None) or str(e)
        return jsonify({'ok': False, 'error': f'创建支付会话失败：{msg}'}), 400
    except Exception as e:
        app.logger.exception("创建支付会话失败")
        return jsonify({'ok': False, 'error': f'创建支付会话失败：{str(e)}'}), 500


# === Manage Subscription (Billing Portal / Upgrade / Cancel) ===


@app.route('/api/billing/upgrade', methods=['POST'])
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
        app.logger.exception("upgrade failed")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/billing/cancel', methods=['POST'])
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
        app.logger.exception("cancel failed")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/billing/webhook', methods=['POST'])
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
        app.logger.warning(f"Webhook 验签失败: {e}")
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
@app.route('/api/billing/verify', methods=['POST'])
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
        app.logger.exception(f"Stripe API 错误: {e}")
        return jsonify({'ok': False, 'msg': f'Stripe 错误: {str(e)}'}), 400
    except Exception as e:
        app.logger.exception("verify failed")
        return jsonify({'ok': False, 'msg': f'服务器错误: {str(e)}'}), 500

@app.route('/api/billing/portal', methods=['POST'])
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
        app.logger.error(f"Create billing portal failed: {e}", exc_info=True)
        # 保留可读的错误信息，便于你在前端 alert
        return str(e), 400


@app.route('/api/user/update-profile', methods=['POST'])
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
                app.logger.error(f"保存头像失败: {e}")
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
        app.logger.error(f"更新用户资料失败: {e}")
        db.session.rollback()
        return jsonify({'error': '更新失败，请重试'}), 500

def _user_status_payload():
    """把当前用户状态打包给前端：积分 + 订阅等级"""
    plan = getattr(current_user, 'plan', 'free') or 'free'
    if plan == 'creator':
        plan = 'lite'
    if plan not in ('free', 'lite', 'pro'):
        plan = 'free'
    return {
        'credits': current_user.credits or 0,
        'subscription_plan': plan
    }


def format_duration(seconds):
    """格式化音频时长为可读字符串"""
    if not isinstance(seconds, (int, float)) or seconds <= 0:
        return '未知'
    
    minutes = int(seconds // 60)
    remaining_seconds = int(seconds % 60)
    
    if minutes < 1:
        return f"{int(seconds)}秒"
    elif remaining_seconds == 0:
        return f"{minutes}分钟"
    else:
        return f"{minutes}:{remaining_seconds:02d}"







# ------------------------- 5. 修复函数 -------------------------

def repair_missing_voice_uri():
    """
    一次性修复函数：为所有缺失 voice_uri 的音色补齐 voice_uri
    运行一次即可，建议在维护时执行
    """
    from sqlalchemy import or_
    
    try:
        # 查找所有 voice_uri 为空或 None 的音色
        voices_to_repair = Voice.query.filter(or_(Voice.voice_uri == None, Voice.voice_uri == '')).all()
        
        if not voices_to_repair:
            logging.info("没有需要修复的音色，所有音色都已具备 voice_uri")
            return
        
        logging.info(f"发现 {len(voices_to_repair)} 个音色需要修复 voice_uri")
        
        # 获取 SiliconFlow API 配置
        api_key = API_KEYS.get('siliconflow_key')
        base_url = API_KEYS.get('siliconflow_base')
        
        if not api_key or not base_url:
            logging.error("未找到 SiliconFlow API 配置，无法修复 voice_uri")
            return
        
        dirty = False
        success_count = 0
        
        for voice in voices_to_repair:
            try:
                logging.info(f"正在修复音色: {voice.name}")
                uri = upload_voice_to_siliconflow(voice, api_key, base_url)
                if uri:
                    voice.voice_uri = uri
                    dirty = True
                    success_count += 1
                    logging.info(f"成功修复音色 {voice.name} -> {uri}")
                else:
                    logging.warning(f"修复音色 {voice.name} 失败，上传返回空")
            except Exception as e:
                logging.error(f"修复音色 {voice.name} 异常: {e}")
        
        if dirty:
            db.session.commit()
            logging.info(f"修复完成：成功修复 {success_count} 个音色")
        else:
            logging.warning("没有成功修复任何音色")
            
    except Exception as e:
        logging.exception(f"修复 voice_uri 过程异常: {e}")
        db.session.rollback()

# ------------------------- 6. 主程序入口 -------------------------

if __name__ == '__main__':
    # 启动时加载API密钥和Base URL
    load_keys_on_startup()
    
    # 初始化数据库（包括迁移）
    init_database()
    
    # 确保用户表有必要的字段
    _ensure_user_columns()
    
    # 验证 Stripe 配置
    _validate_stripe_config()
    
    # 启动Flask服务器
    app.run(host='0.0.0.0', port=5000, debug=True)
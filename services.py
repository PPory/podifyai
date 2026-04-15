import os
import shutil
import subprocess
import base64
import uuid
import logging
import requests
import tempfile
import datetime
from pathlib import Path
import io
import re
import secrets
import smtplib
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from collections import defaultdict
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

from flask import abort, current_app, jsonify, request, send_file, send_from_directory
from openai import OpenAI
from bs4 import BeautifulSoup
import fitz
from mutagen import File
from pydub import AudioSegment, effects
from pydub.silence import detect_nonsilent
import numpy as np
import random
import time
import traceback
from typing import Optional

try:
    import webrtcvad
    _HAS_VAD = True
except Exception:
    _HAS_VAD = False

from flask_login import UserMixin, current_user, login_required, login_user, logout_user
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
from sqlalchemy import func, or_, text
from dotenv import load_dotenv

from extensions import db
from models import CreditTxn, History, OTPCode, StripeEventLog, Subscription, SubscriptionPlan, User, UserAPIKey, Voice

load_dotenv('.env.local', override=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    force=True,
)

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
SF_TTS_MODEL = os.getenv("SF_TTS_MODEL", "FunAudioLLM/CosyVoice2-0.5B")
CREDITS_PER_AUDIO = int(os.getenv("CREDITS_PER_AUDIO", "10"))


# 对齐 MOSS-TTSD 官方参考音频规格：16kHz 单声道，≤10s，MP3 192kbps


# 匹配 [S1]/[S2]/[s1]/[s2] 等任意大小写的说话人标签


def _strip_speaker_tags(text: str) -> str:
    """去除参考文本里所有的 [Sx] 标签，返回纯转录文本。"""
    if not text:
        return ""
    cleaned = _SPEAKER_TAG_RE.sub("", text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    # 去掉常见的残留前缀（冒号、全角冒号等）
    cleaned = cleaned.lstrip(':：,，。.; ').strip()
    return cleaned


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
        base_url=api_base,
        timeout=60.0,
        max_retries=2,
    )

def get_siliconflow_client():
    """获取 SiliconFlow 的客户端"""
    api_key = API_KEYS.get('siliconflow_key')
    api_base = API_KEYS.get('siliconflow_base')

    if not api_key:
        raise ValueError("SiliconFlow API Key 未设置，请先在设置中配置")

    return OpenAI(
        api_key=api_key,
        base_url=api_base,
        timeout=60.0,
        max_retries=2,
    )

# ------------------------- 3. 核心功能函数 -------------------------

TITLE_PLACEHOLDERS = {'', '无标题播客', '未命名标题', '未命名的标题', 'AI生成的播客', 'AI生成的标题'}
GENERIC_SOURCE_TITLES = {'外部链接', '外部网页', 'PDF文档', 'PDF 文件', '文档', '手动输入', '用户输入', '原始输入内容'}


def clean_generated_title(title: str | None) -> str:
    """清理模型返回或前端传入的标题，统一去掉常见包装字符。"""
    cleaned = (title or '').strip()
    cleaned = re.sub(r'^[【\[]?\s*标题\s*[】\]]?\s*[:：-]?\s*', '', cleaned, flags=re.I)
    cleaned = cleaned.strip().strip("\"“”'")
    cleaned = re.sub(r'\s+', ' ', cleaned)
    return cleaned.strip(' \t\r\n-—–:：,，。.、;；!?！？')


def is_placeholder_title(title: str | None) -> bool:
    return clean_generated_title(title) in TITLE_PLACEHOLDERS


def summarize_content_title(raw_text: str | None, max_length: int = 24) -> str:
    """从内容首个有效句子中提炼一个本地兜底标题，避免落回固定占位词。"""
    text = (raw_text or '').replace('\r\n', '\n').replace('\r', '\n')
    if not text.strip():
        return ''

    for raw_line in text.split('\n'):
        line = re.sub(r'^\s*\[S\d+\]\s*', '', raw_line).strip()
        line = re.sub(r'^[【\[]?\s*标题\s*[】\]]?\s*[:：-]?\s*', '', line, flags=re.I)
        line = clean_generated_title(line)
        if not line or is_placeholder_title(line) or line in GENERIC_SOURCE_TITLES:
            continue
        if len(line) > max_length:
            line = line[:max_length].rstrip()
            line = re.sub(r'[，,。.;；:：!?！？、]+$', '', line).rstrip()
        return line
    return ''


def pick_title_source_text(original_input: str | None, script_content: str | None, input_type: str | None = None) -> str:
    normalized_type = (input_type or '').strip().lower()
    candidate = (original_input or '').strip()

    if candidate:
        if normalized_type in {'text', 'manual'}:
            return candidate
        if normalized_type == 'url' and not re.match(r'^https?://\S+$', candidate):
            return candidate
        if normalized_type == 'pdf' and not candidate.startswith('JVBERi0'):
            return candidate
        if normalized_type not in {'url', 'pdf'} and not re.match(r'^https?://\S+$', candidate) and not candidate.startswith('JVBERi0'):
            return candidate

    return (script_content or candidate or '').strip()


def resolve_title_from_content(
    explicit_title: str | None = None,
    source_title: str | None = None,
    original_input: str | None = None,
    script_content: str | None = None,
    input_type: str | None = None,
    gemini_model: str = "gemini-2.5-flash",
) -> str:
    cleaned_title = clean_generated_title(explicit_title)
    if cleaned_title and not is_placeholder_title(cleaned_title):
        return cleaned_title

    cleaned_source_title = clean_generated_title(source_title)
    if cleaned_source_title and cleaned_source_title not in GENERIC_SOURCE_TITLES:
        return cleaned_source_title

    title_source_text = pick_title_source_text(original_input, script_content, input_type)
    if title_source_text:
        try:
            generated_title = generate_title_with_gemini(title_source_text, gemini_model=gemini_model)
            if generated_title and not is_placeholder_title(generated_title):
                return generated_title
        except Exception as exc:
            logging.warning(f"标题生成失败，改用内容首句兜底: {exc}")

    return (
        summarize_content_title(cleaned_source_title)
        or summarize_content_title(title_source_text)
        or summarize_content_title(script_content)
        or '新作品'
    )


def extract_title_and_script(raw_output: str) -> tuple[str, str]:
    """从模型输出中尽量稳健地拆出标题和正文。"""
    txt = (raw_output or '').replace('\r\n', '\n').replace('\r', '\n').strip()
    title = ''

    title_match = re.search(r'(?:^|\n)\s*[【\[]?标题[】\]]?\s*[:：]\s*(.+?)\n+', txt, flags=re.I)
    if title_match:
        title = clean_generated_title(title_match.group(1))
        txt = (txt[:title_match.start()] + '\n' + txt[title_match.end():]).strip()

    txt = re.sub(r'^\s*[-–—]{3,}\s*$', '', txt, flags=re.M).strip()

    if not title:
        non_empty_lines = [line.strip() for line in txt.split('\n') if line.strip()]
        if non_empty_lines:
            first_line = clean_generated_title(non_empty_lines[0])
            if first_line and len(first_line) <= 20 and not is_placeholder_title(first_line):
                title = first_line
                txt = '\n'.join(non_empty_lines[1:]).strip()

    return title or '无标题播客', txt or (raw_output or '').strip()


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
    title = clean_generated_title(completion.choices[0].message.content)
    if not title:
        raise ValueError("标题生成结果为空")
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
    title, script = extract_title_and_script(raw_output)
    title = resolve_title_from_content(
        explicit_title=title,
        original_input=content,
        script_content=script,
        input_type='text',
        gemini_model=gemini_model,
    )

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


# ====== 文本清洗 & 引用构建 & 语言判断 ======
CHN_RE = re.compile(r'[\u4e00-\u9fff]')

def has_chinese(s: str) -> bool:
    """检测文本是否包含中文字符"""
    return bool(CHN_RE.search(s or ''))

def _normalize_dialogue_tags(s: str) -> str:
    """规范化对话标签，将各种格式统一为 [S1]/[S2] 格式"""
    if not s:
        return ''

    lines = []
    for line in s.replace('\r\n', '\n').split('\n'):
        t = line.strip()
        if not t:
            lines.append('')
            continue

        m = re.match(r'^\s*\[?\s*S\s*([12])\s*\]?\s*[:：、.\-]?\s*', t, flags=re.I)
        if m:
            t = f'[S{m.group(1)}]' + t[m.end():]
        lines.append(t)

    fixed = '\n'.join(lines)
    fixed = re.sub(r'\[S([12])\]\s*\[S\1\]\s*', r'[S\1] ', fixed)
    return fixed

def ensure_single_tagging(txt: str) -> str:
    """单人模式：保证每行都带 [S1] 前缀（若已有则规范化，不存在则补上）"""
    t = (txt or "").replace("\r\n", "\n").strip()
    if not t:
        return t
    
    # 先把已有标签规范化，再决定是否补 S1，避免把 [S2] 前缀包成 [S1][S2]
    t = _normalize_dialogue_tags(t)

    if t.startswith('[S2]'):
        t = '[S1]' + t[len('[S2]'):]
    elif not t.startswith('[S1]'):
        t = '[S1]' + ('' if t.startswith('\n') else ' ') + t
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


def _to_mono16k(segment: AudioSegment) -> AudioSegment:
    """转 16k/mono/16bit，小分辨率便于快速做 VAD 与能量扫描"""
    return segment.set_frame_rate(16000).set_channels(1).set_sample_width(2)


def get_voice_by_id_or_403(voice_id: int) -> Voice:
    """通过ID获取音色，并验证权限"""
    voice = Voice.query.get_or_404(voice_id)
    if not (voice.is_global or voice.user_id == current_user.id):
        abort(403, '无权使用该音色')
    return voice

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
        with current_app.app_context():
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
        db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
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

def cleanup_stale_alembic_temp_tables():
    """清理失败迁移遗留的 Alembic 临时表。"""
    try:
        table_names = [row[0] for row in db.session.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()]
        stale_tables = [name for name in table_names if name.startswith("_alembic_tmp_")]
        for name in stale_tables:
            db.session.execute(text(f"DROP TABLE IF EXISTS {name}"))
        if stale_tables:
            db.session.commit()
            logging.info(f"已清理 Alembic 临时表: {stale_tables}")
    except Exception as e:
        db.session.rollback()
        logging.warning(f"清理 Alembic 临时表失败: {e}")


def reconcile_alembic_heads():
    """修正历史分叉造成的 alembic_version 落后问题。"""
    try:
        if not check_table_exists('alembic_version'):
            return

        versions = [row[0] for row in db.session.execute(text('SELECT version_num FROM alembic_version')).fetchall()]
        if versions != ['7b27e4ed97cd']:
            return

        history_cols = {row[1] for row in db.session.execute(text('PRAGMA table_info(history)')).fetchall()}
        voice_cols = {row[1] for row in db.session.execute(text('PRAGMA table_info(voice)')).fetchall()}

        has_original_branch = {'original_input', 'input_type'}.issubset(history_cols)
        has_trace_branch = {'speech_onset_ms', 'voice_id_used', 'voice_uri_used'}.issubset(history_cols) and {'voice_uri', 'source_model'}.issubset(voice_cols)
        if not (has_original_branch and has_trace_branch):
            return

        db.session.execute(text('DELETE FROM alembic_version'))
        db.session.execute(text('INSERT INTO alembic_version (version_num) VALUES (:v)'), {'v': 'add_history_trace_fields'})
        db.session.execute(text('INSERT INTO alembic_version (version_num) VALUES (:v)'), {'v': 'add_original_input_fields'})
        db.session.commit()
        logging.info('已修正 alembic_version 到双分支头，后续 upgrade 将继续执行 merge 之后的迁移')
    except Exception as e:
        db.session.rollback()
        logging.warning(f'修正 alembic_version 失败: {e}')


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

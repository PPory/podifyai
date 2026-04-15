# Codex 交接文档 — PodifyAI 代码重构续工

## 你是谁，在做什么

你接手的是 **PodifyAI**，一个基于 Flask 的 AI 播客生成 Web 应用。它调用 SiliconFlow CosyVoice2 API 合成双人/单人有声内容，支持订阅、积分、语音克隆、PDF/URL 内容抓取。

一轮系统性代码审查已经完成了 P0（7 个严重 Bug）和 Batch 2（MOSS-TTSD 死代码删除）以及大部分 Batch 3（架构快赢）。**你的任务是继续完成剩余工作。**

---

## 先读这些文件，建立完整上下文

| 文件 | 读什么 |
|---|---|
| `CLAUDE.md` | 项目架构总览、运行命令、关键文件说明 |
| `app.py` | 主后端，4950 行，Flask 单文件，47 个路由 |
| `static/script.js` | 主前端，5797 行，单 IIFE |
| `migrations/versions/` | 11 个 migration 文件，了解数据库 schema 演化 |
| `.env.local.example` | 全部 30+ 环境变量的说明 |
| `requirements-web.txt` | Web 层依赖 |
| `requirements-model.txt` | 模型层依赖（本地 GPU 推理，生产不需要） |

**不需要读**：`_archive/`（已归档的死代码和旧文档）、`config.py`（已归档）。

---

## 已完成的工作（不要重做）

### P0 Bug 修复（全部完成）
1. `requirements.txt` 版本修正 + 拆分为 `requirements-web.txt` / `requirements-model.txt`
2. Migrations 多头分叉修复 → `merge_original_input_branch.py`
3. FFMPEG_DIR 去硬编码 → `os.environ.get("FFMPEG_DIR", "")`
4. 文件上传加校验 → `_validate_audio_upload()` + `MAX_CONTENT_LENGTH=50MB`
5. Admin 路由加 `@admin_required` 装饰器
6. 前端 XSS 修复（`thumbnail_filename` 改为 DOM 属性赋值 + 正则白名单）
7. 重名函数 `sanitize_single_text` 合并

### Batch 2 — MOSS-TTSD 彻底删除（完成）
- 删除约 850 行死代码（`finalize_tts_output`、onset 检测 block、19 个 MOSS-TTSD 函数）
- `SF_TTS_MODEL` 默认值改为 `FunAudioLLM/CosyVoice2-0.5B`
- 新增 `drop_speech_onset_ms` migration
- 归档 `tools/diagnose_moss_ttsd.py`，删除 `diag_*.mp3/wav`、`debug_last_tts.wav`
- `.env.local.example` 扩充到 79 行覆盖全部变量

### Batch 3 快赢（完成）
- `python-dotenv` 直接 import，删除自制脆弱 fallback loader
- `CREDITS_PER_AUDIO.split('#')` hack 删除
- 所有 OpenAI client 加 `timeout=60.0, max_retries=2`
- DB 索引：`Voice(user_id)`, `Voice(is_global)`, `History(user_id)`, `History(timestamp)` + `add_performance_indexes` migration
- `SESSION_COOKIE_SECURE` 默认改 `True`，通过 env 覆盖
- `config.py` 归档（从未被 import）
- 前端 payload 死字段清理（去掉 `voiceName`/`s1`/`s2`/`s1_voice_name`/`s2_voice_name`/`voices`）
- `apiPost` 集中错误处理（401→跳登录，402→`err.paymentRequired`，403→权限提示）
- 402 积分不足专属提示文案

---

## 你需要完成的工作

### 任务 A — `app.py` 拆 Blueprint（最重要）

**现状**：`app.py` 4950 行，单文件包含模型定义、业务逻辑、47 个路由，维护困难。

**目标结构**：

```
app.py              ← 保留，只做 app 工厂 + Blueprint 注册，<100 行
models.py           ← 所有 db.Model 类
auth.py             ← Blueprint: prefix="" 认证相关路由
voices.py           ← Blueprint: prefix="" 音色管理路由  
history.py          ← Blueprint: prefix="" 历史记录路由
tts.py              ← Blueprint: prefix="" TTS 合成路由
billing.py          ← Blueprint: prefix="" 计费路由
content.py          ← Blueprint: prefix="" 内容提取/脚本生成路由
static_routes.py    ← 静态文件 / index / 404 路由
```

**拆分依据（按路由前缀）**：

```
auth.py:
  POST /register, /login, /logout
  POST /auth/login-password, /auth/request-code, /auth/verify-code
  POST /account/password/*, /account/email/*
  POST /auth/password/forgot/*
  POST /api/send-otp, /api/verify-otp, /api/register-with-otp
  POST /api/user/update-profile
  GET  /api/user/status

voices.py:
  GET/POST /voices
  PUT/DELETE /voices/<id>
  POST/PUT/DELETE/GET /admin/voices, /admin/voices/<id>

history.py:
  GET  /history
  DELETE /history/<id>
  POST /history/play/<id>, /history/update_duration/<id>
  GET  /api/history/<hid>

tts.py:
  POST /synthesize-audio
  POST /generate-title

billing.py:
  POST /api/billing/checkout, /upgrade, /cancel, /webhook, /verify, /portal

content.py:
  POST /api/extract_from_url
  POST /generate-script

static_routes.py:
  GET  /  (index.html)
  GET  /login, /register  (templates)
  GET  /history_audio/<filename>
  GET  /pdf_storage/<filename>
  GET  /<path:path>
```

**关键注意事项**：

1. `models.py` 必须最先创建，因为 auth/voices/history/tts 都依赖 `User`/`Voice`/`History` 模型
2. `db`、`login_manager`、`CORS` 在 `app.py` 工厂函数中初始化，通过 `from app import db` 或使用 `db = SQLAlchemy()` 延迟初始化模式
3. **推荐用延迟初始化**（避免循环 import）：
   ```python
   # extensions.py
   from flask_sqlalchemy import SQLAlchemy
   from flask_login import LoginManager
   db = SQLAlchemy()
   login_manager = LoginManager()
   ```
   然后 `app.py` 做 `db.init_app(app)`，各模块从 `extensions` 导入 `db`
4. `admin_required` 装饰器放 `auth.py` 或单独的 `decorators.py`
5. 辅助函数（`get_voice_by_id_or_403`、`_validate_audio_upload`、`sanitize_single_text` 等）按归属放到对应模块，或集中到 `utils.py`
6. 全局常量（`CREDITS_PER_AUDIO`、`SF_TTS_MODEL`、`API_KEYS`、`HISTORY_AUDIO_DIR` 等）放 `config_loader.py` 或直接在 `app.py` 工厂里 + 通过 `app.config` 传递
7. migrations/ 不需要动，`flask db upgrade` 依然有效

**验证方式**：
```bash
python -X utf8 -c "import app"   # 无报错
flask db upgrade                   # migration 链正常
# 手动走一次：登录 → 选音色 → 合成 → 播放历史
```

---

### 任务 B — `static/script.js` 拆模块

**现状**：5797 行单 IIFE，所有逻辑混在一起。

**目标结构**（ES module 或传统多文件按顺序 `<script>` 加载均可，推荐传统多文件以避免改 HTML）：

```
static/
  api.js          ← apiPost + apiGet + 集中错误处理（已存在于 script.js 头部）
  player.js       ← playerManager class（约 280 行，script.js:280-560）
  history.js      ← loadHistory / renderHistoryGrid / history card 相关（约 400 行）
  voice.js        ← loadVoices / voice selector / voice CRUD UI（约 600 行）
  synth.js        ← 合成按钮事件 / generate-script / title 生成（约 500 行）
  settings.js     ← 设置面板 / 订阅 / 积分充值 UI（约 400 行）
  script.js       ← 保留，只做初始化入口 + 各模块组装，<200 行
```

**拆分步骤建议**：
1. 先不改 `script.js`，把要抽取的函数复制到新文件，验证无重复定义
2. 在 `index.html` 的 `<script>` 标签中按顺序加载新文件（api.js → player.js → voice.js → history.js → synth.js → settings.js → script.js）
3. 逐步从 `script.js` 中删除已迁移的代码
4. 确保 `playerManager`、`selectedVoiceIds`、`historyItems` 等跨模块共享状态通过一个 `state.js` 或 `window.*` 管理（现在已经部分挂在 `window` 上）

**需要清理的 @deprecated 变量**（script.js:197-253）：
```javascript
let playlist = [];                    // @deprecated
let currentPlaylistIndex = 0;        // @deprecated
const playlistAudio = new Audio();   // @deprecated
let currentCardPlayBtn = null;       // @deprecated
let historyItems = [];               // @deprecated
```
确认没有调用点后删除（搜索 `playlistAudio`、`currentCardPlayBtn` 等）。

---

### 任务 C — 补 `CreditTxn` / `Subscription` ORM 模型

**现状**：`flask db upgrade` 建了 `credit_txn` 和 `subscription` 表（见 `7dc38e7ab782_add_credits_and_subscription_system.py`），但 `app.py` 里没有对应的 ORM 模型，无法用 SQLAlchemy 查询流水记录。

**需要补的模型**（加到 `models.py`，或现阶段加到 `app.py` 的 Model 区域）：

```python
class CreditTxn(db.Model):
    """积分流水记录"""
    __tablename__ = 'credit_txn'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    amount = db.Column(db.Integer, nullable=False)          # 正数=充值，负数=消耗
    balance_after = db.Column(db.Integer, nullable=False)   # 交易后余额
    reason = db.Column(db.String(128))                      # 'synthesis' | 'purchase' | 'admin'
    ref_id = db.Column(db.String(128))                      # Stripe session ID 或 history ID
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, index=True)
    owner = db.relationship('User', backref='credit_txns')

class Subscription(db.Model):
    """用户订阅状态"""
    __tablename__ = 'subscription'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)
    plan = db.Column(db.String(32), nullable=False, default='free')  # 'free'|'lite'|'pro'
    stripe_customer_id = db.Column(db.String(128))
    stripe_subscription_id = db.Column(db.String(128))
    current_period_end = db.Column(db.DateTime)
    cancel_at_period_end = db.Column(db.Boolean, default=False)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    owner = db.relationship('User', backref=db.backref('subscription', uselist=False))
```

验证方式：`python -c "from app import CreditTxn, Subscription; print('OK')"`

---

### 任务 D — 数据库安全补丁

**`/history_audio/<filename>` 和 `/pdf_storage/<filename>` 缺少所有权校验**：

当前代码（`app.py` 约 4041、4049 行）：
```python
@app.route('/history_audio/<path:filename>')
@login_required
def serve_history_audio(filename):
    return send_from_directory(HISTORY_AUDIO_DIR, filename)
```

问题：知道其他用户的 UUID 文件名就能下载，只需登录不需所有权。

修复方式：
```python
@app.route('/history_audio/<path:filename>')
@login_required
def serve_history_audio(filename):
    # 从文件名提取 history_id（格式为 history_{uuid}.mp3）
    stem = Path(filename).stem  # e.g. "history_abc123"
    if stem.startswith('history_'):
        hid = stem[len('history_'):]
        h = History.query.filter_by(id=hid, user_id=current_user.id).first()
        if not h:
            abort(403)
    return send_from_directory(HISTORY_AUDIO_DIR, filename)
```

同样逻辑应用于 `/pdf_storage/<filename>`（用 `current_user.id` 验证 PDF 是否属于当前用户，需要在上传时记录所有权）。

---

## 工作守则

1. **每完成一个任务先跑语法检查**：
   ```bash
   python -X utf8 -c "import ast; ast.parse(open('app.py', encoding='utf-8').read()); print('OK')"
   node --check static/script.js
   ```

2. **不要改 migration 文件**：数据库 schema 已经稳定，不要新建 migration（除非任务 C 需要补列）。

3. **不要改 TTS 合成逻辑**（`tts_cosyvoice_per_turn`、`_ensure_voice_uri`）：这是核心路径，已经过验证可用。

4. **Blueprint 拆分不改路由 URL**：所有对外 URL 必须与现在完全一致，只是代码组织变化。

5. **优先顺序**：A（Blueprint）> C（ORM 模型）> D（安全补丁）> B（JS 拆分）

---

## 快速验证清单

任务完成后，手工走一遍：

- [ ] `python -X utf8 app.py` 无报错启动
- [ ] `flask db upgrade` 无报错
- [ ] 登录 → 选音色 → 输入文本 → 合成 → 历史记录出现 → 播放正常
- [ ] 用普通用户访问 `/admin/voices` → 返回 403
- [ ] 上传 `.exe` 文件作为参考音频 → 被拒绝
- [ ] 访问他人的 history_audio URL → 返回 403（任务 D 完成后）

# PodifyAI

PodifyAI 是一个面向内容创作的 AI 播客 Web 应用。它把 URL、PDF 或纯文本整理成可播客化的内容，再生成标题、脚本和音频。当前生产链路以 Flask Web 应用为主，音频合成走 SiliconFlow CosyVoice2，标题和脚本生成走 Gemini / OpenAI 兼容接口。

## 当前仓库定位

- 当前 GitHub 仓库的主要交付对象是 PodifyAI Web 应用，不再是原始的 MOSS-TTSD 模型说明页。
- 仓库里仍保留部分模型相关文件，方便兼容、研究或本地实验。
- 如果你只是部署 Web 产品，优先关注 `requirements-web.txt`、`requirements-ec2.txt`、`VPS_DEPLOY_RUNBOOK.md` 和 `deploy/`。

## 主要能力

- URL、PDF、纯文本三种输入方式
- 先创作播客内容，再合成音频；也支持直接对粘贴文本合成
- Gemini 自动生成标题，失败时使用内容兜底
- 单人 / 多人音频合成
- 用户登录、OTP、找回密码、资料更新
- 个人音色库和管理员全局音色管理
- 历史记录、在线播放、时长更新、文件访问权限校验
- 积分消耗、Stripe 订阅和充值流程
- 适合单机部署：SQLite + 本地音频 / PDF 存储

## 技术栈

- 后端：Flask、SQLAlchemy、Flask-Login、Flask-Migrate
- 前端：原生 HTML + JavaScript
- 数据库：SQLite
- 音频合成：SiliconFlow CosyVoice2 API
- 文本生成：Gemini / OpenAI-compatible API
- 部署：Gunicorn + systemd + Nginx

## 目录结构

```text
app.py            Flask 应用入口
models.py         数据模型
auth.py           登录、注册、OTP、账号相关接口
content.py        URL / PDF / 文本内容提取与脚本生成
tts.py            标题生成与音频合成
voices.py         音色库与管理员音色管理
history.py        历史记录与音频访问
billing.py        积分、订阅、支付相关接口
static/           前端脚本
templates/        登录、注册页面
deploy/           EC2、Nginx、systemd 示例文件
tests/            运行检查与 smoke tests
```

## 本地启动

### 1. 安装依赖

```bash
git clone <your-github-repo-url> podifyai
cd podifyai
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

macOS / Linux:

```bash
source .venv/bin/activate
```

继续安装：

```bash
pip install --upgrade pip
pip install -r requirements-web.txt
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

至少需要填写：

- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `SILICONFLOW_API_KEY`
- `OPENAI_API_KEY`

按需再填写：

- `SENDGRID_*` 或 SMTP 配置
- `STRIPE_*`
- OTP 服务商相关配置

完整示例见 `.env.local.example`。

### 3. 启动项目

```bash
python app.py
```

默认访问地址：`http://127.0.0.1:5000`

## 常用检查命令

```bash
python -X utf8 -m unittest discover -s tests -v
python -X utf8 -c "import app; print('IMPORT_OK')"
node --check static/api.js
node --check static/synth.js
node --check static/history.js
node --check static/player.js
```

## 生产部署

部署文档已经按分工整理成三层：

- `VPS_DEPLOY_RUNBOOK.md`：主手册，包含完整部署、HTTPS、日常更新和排障
- `EC2_DEPLOY.md`：快速部署清单，只保留最短操作路径
- `deploy/ec2/README.md`：部署目录说明，解释各个脚本和模板的用途

如果你是在 Linux 服务器上直接部署，安装依赖时使用 `requirements-ec2.txt`。

## 依赖说明

- `requirements-web.txt`：Web 应用运行依赖
- `requirements-ec2.txt`：EC2 / VPS 部署最小依赖
- `requirements-model.txt`：模型 / 本地推理相关依赖
- `requirements.txt`：当前项目总依赖集合

## 文档索引

- `CODEX_HANDOFF.md`：本轮重构与遗留事项说明
- `AUTH_API_README.md`：认证接口说明
- `README_CREDITS_SYSTEM.md`：积分系统说明
- `STRIPE_INTEGRATION_GUIDE.md`：Stripe 支付说明
- `VOICE_MANAGEMENT_GUIDE.md`：音色管理说明
- `SENDGRID_INTEGRATION_README.md`：邮件发送说明
- `DATABASE_SETUP_README.md`：数据库初始化说明
- `VPS_DEPLOY_RUNBOOK.md`：VPS / EC2 全流程部署与排障手册
- `EC2_DEPLOY.md`：EC2 快速部署清单
- `deploy/ec2/README.md`：部署文件说明

## 备注

- 当前默认是单机架构，`app.db`、`history_audio/`、`pdf_storage/` 都保存在当前机器上。
- 如果后续要做多机部署，需要把数据库和文件存储拆出去。
- 如果你想查看原始 MOSS-TTSD 模型说明，应参考上游 OpenMOSS 项目文档，而不是当前这个 README。

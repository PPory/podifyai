# PodifyAI

PodifyAI 是一个 AI 播客 Web 应用，可以把 URL、PDF 和长文本整理成播客脚本，并生成可播放的语音。

[English README](README.md) | [文档索引](docs/README.md) | [部署手册](docs/deployment/vps-runbook.md) | [演示视频](asset/video/podifyai-product-launch.mp4)

![PodifyAI 首页](hyperframes/podifyai-brand-15/assets/screens/home-main.png)

## 项目能做什么

- 从 URL、PDF 或粘贴文本导入内容。
- 通过 Gemini 或 OpenAI-compatible API 生成播客标题和脚本。
- 通过 SiliconFlow CosyVoice2 生成单人或多人播客音频。
- 支持登录、注册、OTP、找回密码和资料更新。
- 支持个人音色、管理员全局音色、历史记录和在线播放。
- 支持积分消耗、Stripe 订阅和积分包。
- 适合单机部署：SQLite + 本地音频 / PDF 存储。

## 仓库定位

这个仓库现在的主线是 PodifyAI Web 产品，不再把原始 MOSS-TTSD 模型说明作为首页重点。

仓库中仍保留部分 MOSS-TTSD 相关文件，用于兼容、研究和本地实验。如果你要查看原始模型项目，请参考上游 OpenMOSS 仓库；如果你要部署或了解 PodifyAI，请从当前 README 和 `docs/` 开始。

## 技术栈

- 后端：Flask、SQLAlchemy、Flask-Login、Flask-Migrate
- 前端：HTML、CSS、原生 JavaScript
- 数据库：SQLite
- 文本生成：Gemini 或 OpenAI-compatible API
- 音频合成：SiliconFlow CosyVoice2 API
- 生产部署：Gunicorn、systemd、Nginx

## 目录结构

```text
app.py                 Flask 应用入口和路由注册
auth.py                登录、注册、OTP、账号相关接口
content.py             URL、PDF、文本处理
tts.py                 标题生成和音频合成
voices.py              个人音色和管理员音色库
history.py             历史记录和受保护音频访问
billing.py             积分、订阅和 Stripe 支付
static/                前端脚本和样式
templates/             登录、注册页面
deploy/                systemd、Gunicorn、Nginx 示例
docs/                  项目文档
tests/                 运行检查和 smoke tests
legacy/                保留的 MOSS-TTSD 历史资料
```

## 本地启动

### 1. 创建虚拟环境

```bash
git clone https://github.com/PPory/podifyai.git
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

### 2. 安装 Web 依赖

```bash
python -m pip install --upgrade pip
pip install -r requirements-web.txt
```

### 3. 配置环境变量

```bash
cp .env.local.example .env.local
```

必填项：

- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `SILICONFLOW_API_KEY`
- `OPENAI_API_KEY`

SendGrid、SMTP、Stripe、短信 OTP 等配置按需填写。完整示例见 `.env.local.example`。

### 4. 启动项目

```bash
python app.py
```

默认访问地址：`http://127.0.0.1:5000`

## 检查命令

提交前建议运行：

```bash
python -X utf8 -m unittest discover -s tests -v
python -X utf8 -c "import app; print('IMPORT_OK')"
node --check static/api.js
node --check static/player.js
node --check static/history.js
node --check static/synth.js
node --check static/script.js
```

## 部署

推荐的小型生产部署方式是 Linux VPS + Gunicorn + systemd + Nginx + SQLite + 本地文件存储。

- [完整 VPS 部署手册](docs/deployment/vps-runbook.md)
- [EC2 / VPS 快速清单](docs/deployment/ec2-deploy.md)
- [部署文件说明](deploy/ec2/README.md)

## 文档

完整入口见 [文档索引](docs/README.md)。

常用文档：

- [认证接口](docs/api/auth-api.md)
- [积分系统](docs/billing/credits-system.md)
- [Stripe 支付](docs/billing/stripe-integration.md)
- [音色管理](docs/features/voice-management.md)
- [SendGrid 邮件](docs/integrations/sendgrid.md)
- [数据库初始化](docs/deployment/database-setup.md)

## 开源说明

PodifyAI 保留 Apache 2.0 License。详见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

本仓库包含来自 OpenMOSS / MOSS-TTSD 生态的派生或参考内容。`legacy/` 目录只作为历史资料保留，不作为 PodifyAI 主入口。

## 参与贡献

仓库公开后欢迎提交 issue 和 pull request。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

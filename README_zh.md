# PodifyAI

PodifyAI 是一个 AI 播客 Web 应用，可以把 URL、PDF 和长文本整理成播客脚本，并生成可播放的语音。

[English README](README.md) | [文档索引](docs/README.md) | [部署手册](docs/deployment/vps-runbook.md) | [演示视频](showcase/assets/video/podifyai-product-launch.mp4)

![PodifyAI 首页](docs/assets/home.png)

## 项目状态

- 当前是早期开源项目，主要由个人维护。
- 仓库包含部署说明、环境变量模板、本地截图和运行检查。
- 目前不声明公开在线 Demo、用户量或生产规模。
- 欢迎提交带复现步骤的问题、部署反馈和明确的改进建议。

## 项目能做什么

- 从 URL、PDF 或粘贴文本导入内容。
- 通过 Gemini 或 OpenAI-compatible API 生成播客标题和脚本。
- 通过 SiliconFlow CosyVoice2 生成单人或多人播客音频。
- 支持登录、注册、OTP、找回密码和资料更新。
- 支持个人音色、历史记录和在线播放。
- 支持积分消耗、Stripe 订阅和积分包。
- 适合单机部署：SQLite + 本地音频 / PDF 存储。

## 仓库结构

```text
podifyai/      Web 应用源码、页面模板和静态资源
tests/         运行检查和 smoke tests
deploy/        systemd、Gunicorn、Nginx 示例
docs/          产品、接口、支付和部署文档
migrations/    数据库迁移
showcase/      演示视频、截图和视频工程源文件
research/      保留的 MOSS-TTSD 历史资料
tools/         本地维护脚本
```

根目录只保留 README、许可证、依赖文件、应用入口和项目文件夹。

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
pip install -r requirements/web.txt
```

### 3. 配置环境变量

```bash
cp .env.example .env.local
```

必填项：

- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `SILICONFLOW_API_KEY`
- `OPENAI_API_KEY`

SendGrid、SMTP、Stripe、短信 OTP 等配置按需填写。

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
node --check podifyai/static/api.js
node --check podifyai/static/player.js
node --check podifyai/static/history.js
node --check podifyai/static/synth.js
node --check podifyai/static/script.js
```

## 部署

推荐的小型生产部署方式是 Linux VPS + Gunicorn + systemd + Nginx + SQLite + 本地文件存储。

- [完整 VPS 部署手册](docs/deployment/vps-runbook.md)
- [EC2 / VPS 快速清单](docs/deployment/ec2-deploy.md)
- [部署文件说明](deploy/ec2/README.md)

## 文档

完整入口见 [文档索引](docs/README.md)。

常用文档：

- [本地演示截图](docs/demo.md)
- [Roadmap](docs/roadmap.md)
- [认证接口](docs/api/auth-api.md)
- [积分系统](docs/billing/credits-system.md)
- [Stripe 支付](docs/billing/stripe-integration.md)
- [音色管理](docs/features/voice-management.md)
- [SendGrid 邮件](docs/integrations/sendgrid.md)
- [数据库初始化](docs/deployment/database-setup.md)

## 开源说明

PodifyAI 保留 Apache 2.0 License。详见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

本仓库包含来自 OpenMOSS / MOSS-TTSD 生态的派生或参考内容。`research/` 目录只作为历史资料保留，不作为 PodifyAI 主入口。

## 参与贡献

仓库公开后欢迎提交 issue 和 pull request。提交前请阅读 [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)、[.github/SECURITY.md](.github/SECURITY.md) 和 [.github/CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md)。

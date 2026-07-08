# PodifyAI

PodifyAI is a Flask-based AI podcast web app that turns URLs, PDFs, and long text into podcast-ready scripts and generated audio.

[Chinese README](README_zh.md) | [Documentation](docs/README.md) | [Deployment guide](docs/deployment/vps-runbook.md) | [Demo video](showcase/assets/video/podifyai-product-launch.mp4)

![PodifyAI home screen](docs/assets/home.png)

## Project Status

- Early-stage open-source project maintained primarily by one person.
- Includes deployment notes, environment templates, local screenshots, and runtime tests.
- No public hosted demo or production usage metric is claimed yet.
- Issues with clear reproduction steps, deployment feedback, and focused improvement ideas are welcome.

## What It Does

- Imports content from URLs, PDFs, or pasted text.
- Generates podcast titles and scripts through Gemini or an OpenAI-compatible API.
- Synthesizes single-speaker or multi-speaker audio with SiliconFlow CosyVoice2.
- Manages user accounts, OTP verification, password reset, and profile updates.
- Stores voice presets, generation history, and playback metadata.
- Supports credits, Stripe subscriptions, and one-time credit packs.
- Runs as a single-server app with SQLite and local file storage.

## Repository Layout

```text
podifyai/      Web app package, templates, and static assets
tests/         Runtime and integration smoke tests
deploy/        systemd, Gunicorn, and Nginx examples
docs/          Product, API, billing, and deployment docs
migrations/    Database migrations
showcase/      Demo videos, screenshots, and video source projects
research/      Historical MOSS-TTSD model material kept for reference
tools/         Local maintenance scripts
```

The repository root intentionally stays small: README, license files, dependency files, app entrypoints, and project folders.

## Quick Start

### 1. Create a virtual environment

```bash
git clone https://github.com/PPory/podifyai.git
cd podifyai
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

macOS or Linux:

```bash
source .venv/bin/activate
```

### 2. Install web dependencies

```bash
python -m pip install --upgrade pip
pip install -r requirements/web.txt
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Required values:

- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `SILICONFLOW_API_KEY`
- `OPENAI_API_KEY`

Optional integrations include SendGrid, SMTP, Stripe, Twilio, Aliyun SMS, and Tencent Cloud SMS.

### 4. Run the app

```bash
python app.py
```

Open `http://127.0.0.1:5000`.

## Verification

Use these checks before committing changes:

```bash
python -X utf8 -m unittest discover -s tests -v
python -X utf8 -c "import app; print('IMPORT_OK')"
node --check podifyai/static/api.js
node --check podifyai/static/player.js
node --check podifyai/static/history.js
node --check podifyai/static/synth.js
node --check podifyai/static/script.js
```

## Deployment

For a small production deployment, use a Linux VPS with Gunicorn, systemd, Nginx, SQLite, and local storage.

- [Full VPS runbook](docs/deployment/vps-runbook.md)
- [Short EC2/VPS checklist](docs/deployment/ec2-deploy.md)
- [Deployment file reference](deploy/ec2/README.md)

## Documentation

Start with the [documentation index](docs/README.md).

Main areas:

- [Local demo screenshots](docs/demo.md)
- [Roadmap](docs/roadmap.md)
- [Authentication APIs](docs/api/auth-api.md)
- [Credits system](docs/billing/credits-system.md)
- [Stripe integration](docs/billing/stripe-integration.md)
- [Voice management](docs/features/voice-management.md)
- [SendGrid integration](docs/integrations/sendgrid.md)
- [Database setup](docs/deployment/database-setup.md)

## Open Source Notes

PodifyAI keeps Apache 2.0 licensing. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This repository includes work derived from or inspired by OpenMOSS / MOSS-TTSD. The `research/` directory is retained as historical reference and is not the main entry point for PodifyAI.

## Contributing

Contributions are welcome after the repository is made public. Please read [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md), [.github/SECURITY.md](.github/SECURITY.md), and [.github/CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md) before opening issues or pull requests.

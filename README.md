# PodifyAI

PodifyAI is a Flask-based AI podcast web app that turns URLs, PDFs, and long text into podcast-ready scripts and generated audio.

[Chinese README](README_zh.md) | [Documentation](docs/README.md) | [Deployment guide](docs/deployment/vps-runbook.md) | [Demo video](asset/video/podifyai-product-launch.mp4)

![PodifyAI home screen](hyperframes/podifyai-brand-15/assets/screens/home-main.png)

## Project Status

- PodifyAI is an early-stage open-source project maintained primarily by one person.
- The repository includes a license, environment templates, deployment notes, local demo screenshots, and basic runtime tests.
- There is no public hosted demo or production usage metric to claim yet.
- The app has been deployed and tested on a small VPS before; documentation, tests, deployment stability, and security checks will continue to improve.
- Issues with clear reproduction steps, deployment feedback, and focused improvement ideas are welcome.

## What It Does

- Imports content from URLs, PDFs, or pasted text.
- Generates podcast titles and scripts through Gemini or an OpenAI-compatible API.
- Synthesizes single-speaker or multi-speaker audio with SiliconFlow CosyVoice2.
- Manages user accounts, OTP verification, password reset, and profile updates.
- Stores voice presets, personal voice references, generation history, and playback metadata.
- Supports credits, Stripe subscriptions, and one-time credit packs.
- Runs as a single-server app with SQLite and local file storage.

## Why This Repository Exists

This repository is focused on the PodifyAI web product. It was built from the MOSS-TTSD ecosystem and still keeps selected model-related files for compatibility, research, and local experiments.

If you want the original MOSS-TTSD model project, use the upstream OpenMOSS repository. If you want the deployable PodifyAI web app, start here.

## Tech Stack

- Backend: Flask, SQLAlchemy, Flask-Login, Flask-Migrate
- Frontend: HTML, CSS, vanilla JavaScript
- Database: SQLite
- Text generation: Gemini or OpenAI-compatible API
- Speech synthesis: SiliconFlow CosyVoice2 API
- Production runtime: Gunicorn, systemd, Nginx

## Repository Layout

```text
app.py                 Flask app factory and route registration
auth.py                Login, registration, OTP, and account APIs
content.py             URL, PDF, and text processing
tts.py                 Title generation and audio synthesis
voices.py              Personal and admin voice library
history.py             Audio history and protected file access
billing.py             Credits, subscriptions, and Stripe routes
static/                Browser-side scripts and styles
templates/             Login and registration pages
deploy/                systemd, Gunicorn, and Nginx examples
docs/                  Project documentation
tests/                 Runtime and integration smoke tests
legacy/                Historical MOSS-TTSD material kept for reference
```

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
pip install -r requirements-web.txt
```

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Required values:

- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `SILICONFLOW_API_KEY`
- `OPENAI_API_KEY`

Optional integrations include SendGrid, SMTP, Stripe, Twilio, Aliyun SMS, and Tencent Cloud SMS. See `.env.local.example` for the full list. `.env.example` is kept as a shorter reference.

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
node --check static/api.js
node --check static/player.js
node --check static/history.js
node --check static/synth.js
node --check static/script.js
```

## Deployment

For a small production deployment, use a Linux VPS with Gunicorn, systemd, Nginx, SQLite, and local storage.

- [Full VPS runbook](docs/deployment/vps-runbook.md)
- [Short EC2/VPS checklist](docs/deployment/ec2-deploy.md)
- [Deployment file reference](deploy/ec2/README.md)

## Documentation

Start with the [documentation index](docs/README.md).

Main areas:

- [Local demo screenshots](DEMO.md)
- [Roadmap](ROADMAP.md)
- [Authentication APIs](docs/api/auth-api.md)
- [Credits system](docs/billing/credits-system.md)
- [Stripe integration](docs/billing/stripe-integration.md)
- [Voice management](docs/features/voice-management.md)
- [SendGrid integration](docs/integrations/sendgrid.md)
- [Database setup](docs/deployment/database-setup.md)

## Open Source Notes

PodifyAI keeps Apache 2.0 licensing. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

This repository includes work derived from or inspired by OpenMOSS / MOSS-TTSD. The `legacy/` directory is retained as historical reference and is not the main entry point for PodifyAI.

## Contributing

Contributions are welcome after the repository is made public. Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening issues or pull requests.

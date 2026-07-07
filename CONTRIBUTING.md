# Contributing to PodifyAI

PodifyAI is an early-stage open-source project. Contributions, bug reports, deployment notes, and documentation improvements are welcome.

## Before You Start

- Read the main [README](README.md) and the [documentation index](docs/README.md).
- Keep changes focused. Avoid unrelated cleanup in the same pull request.
- Do not commit secrets, local databases, generated audio, uploaded PDFs, or personal voice files.

## Good First Contributions

- Report a clear bug with reproduction steps.
- Improve setup or deployment documentation.
- Add or update tests for existing behavior.
- Improve error messages or validation around user input.
- Review security-sensitive flows such as authentication, file access, and API key handling.

## Local Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-web.txt
cp .env.local.example .env.local
python app.py
```

On macOS or Linux, activate the environment with:

```bash
source .venv/bin/activate
```

## Checks

Run these before opening a pull request:

```bash
python -X utf8 -m unittest discover -s tests -v
python -X utf8 -c "import app; print('IMPORT_OK')"
node --check static/api.js
node --check static/player.js
node --check static/history.js
node --check static/synth.js
node --check static/script.js
```

## Pull Request Guidelines

- Explain what changed and why.
- Mention any migration, environment variable, or deployment impact.
- Include screenshots for UI changes.
- Include test results or explain why a check could not be run.

## Reporting Issues

Use the issue templates in `.github/ISSUE_TEMPLATE/`. Include clear reproduction steps, expected behavior, actual behavior, logs, and environment details.

## Security

Do not open public issues containing secrets, private user data, server credentials, or exploit details. Use the process in [SECURITY.md](SECURITY.md).

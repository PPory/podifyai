# Contributing to PodifyAI

PodifyAI is an early-stage open-source project. Contributions, bug reports, deployment notes, and documentation improvements are welcome.

## Good first contributions

- Report a clear bug with reproduction steps.
- Improve setup or deployment documentation.
- Add or update tests for existing behavior.
- Improve error messages or validation around user input.
- Review security-sensitive flows such as authentication, file access, and API key handling.

## Before opening an issue

Please include:

- What you expected to happen.
- What actually happened.
- Steps to reproduce the issue.
- Your operating system and Python version.
- Relevant logs with secrets removed.

## Before opening a pull request

Please keep changes focused and small. A good pull request should:

- Explain the problem it solves.
- Avoid unrelated refactoring.
- Include tests or a clear verification note when possible.
- Avoid committing `.env`, database files, generated audio, uploaded files, logs, or API keys.

## Local checks

```bash
python -X utf8 -m unittest discover -s tests -v
python -X utf8 -c "import app; print('IMPORT_OK')"
node --check static/api.js
node --check static/synth.js
node --check static/history.js
node --check static/player.js
```

## Security

Please do not open public issues containing secrets, private user data, server credentials, or exploit details. Use the process in `SECURITY.md`.

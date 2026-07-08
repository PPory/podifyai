# Security Policy

PodifyAI handles user accounts, password reset flows, OTP login, file uploads, generated audio files, API key configuration, and optional payment or email integrations.

## Supported Scope

Security reports should focus on the current PodifyAI web application, deployment files, and documentation in this repository.

The historical files under `research/` are kept for reference and may not receive the same level of active maintenance.

Security-sensitive areas include:

- Authentication and password reset
- OTP verification
- Uploaded PDF and audio file handling
- Access control for generated audio history
- API key and environment variable handling
- Stripe and SendGrid configuration
- Dependency vulnerabilities

## Reporting a Vulnerability

Please do not publish sensitive security details in a public issue.

If this repository is public, use GitHub's private vulnerability reporting feature when available. If private reporting is not available, contact the maintainer directly instead of opening a public issue with exploit details.

Please include:

- Affected component or route
- Reproduction steps
- Expected and actual impact
- Relevant logs, screenshots, or request examples with secrets removed
- Whether secrets, user data, payment data, or generated files may be exposed

## Secrets

Never commit real values for:

- `SECRET_KEY`
- `SILICONFLOW_API_KEY`
- `OPENAI_API_KEY`
- `SENDGRID_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- SMS provider credentials

Use `.env.example` for placeholders and keep real credentials in `.env.local` or deployment secrets.

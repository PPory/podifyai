# Security Policy

PodifyAI handles user accounts, password reset flows, OTP login, file uploads, generated audio files, API key configuration, and optional payment or email integrations. Security reports are welcome.

## Reporting a vulnerability

Please do not publish sensitive security details in a public issue.

If you find a vulnerability, contact the maintainer through GitHub with:

- A short description of the issue.
- A minimal reproduction if possible.
- The affected files or endpoints.
- Any relevant logs with secrets removed.

## Scope

Security-sensitive areas include:

- Authentication and password reset.
- OTP verification.
- Uploaded PDF and audio file handling.
- Access control for generated audio history.
- API key and environment variable handling.
- Stripe and SendGrid configuration.
- Dependency vulnerabilities.

## Maintainer response

The maintainer will review reports as soon as possible, confirm the affected area, and publish a fix or mitigation when appropriate.

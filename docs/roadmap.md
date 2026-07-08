# Roadmap

PodifyAI is currently an early-stage open-source project. This roadmap focuses on making the project easier to inspect, deploy, and maintain.

## Near term

- Improve public setup documentation and reduce ambiguity around required environment variables.
- Add clearer screenshots or a short local demo guide.
- Strengthen tests for URL extraction, PDF handling, title generation fallback, and audio history access.
- Review authentication, OTP, password reset, upload handling, and generated audio access.
- Keep deployment docs current for VPS, EC2, Gunicorn, Nginx, and HTTPS.

## Medium term

- Split local storage concerns so database, uploaded files, and generated audio can move to managed storage.
- Add a clearer release process and changelog.
- Improve error reporting for failed content extraction and audio generation.
- Add more contributor-friendly issue templates and test fixtures.

## Current limitations

- No public hosted demo is currently available.
- The default deployment model is single-machine SQLite plus local file storage.
- Public adoption metrics are not yet available.

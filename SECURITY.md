# Security policy

## Project status

Screen Share is early development software. Only M0 control/UI/local infrastructure exists. Product authentication, capture, WebRTC media, and E2EE are not implemented. The local Compose setup is not intended for internet or LAN exposure. No release is currently supported as a secure production deployment.

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/jaovito/screen-share/security/advisories/new) to contact the maintainer. Do not publish credentials, exploit details, personal media, window titles, or sensitive logs in public issues/PRs. If private reporting is temporarily unavailable, open a minimal issue asking for a private contact channel without disclosing vulnerability details.

Include affected commit/version, platform, prerequisites, expected boundary, observed behavior, and a minimal sanitized local reproduction. Use synthetic data and resources you own. No testing against other users, deployed services, or third-party infrastructure is authorized by this policy.

The maintainer will investigate and coordinate remediation/disclosure as availability permits. There is no guaranteed response SLA or bug-bounty program. Code-review automation, unit tests, and coverage are not security certification.

## Development safeguards

Never commit .env or effective LiveKit configuration; bootstrap generates local secrets. Administrative credentials stay outside frontend bundles and IPC. Preserve application authorization/validation/auditing, explicit capture consent, and migration history. See [security architecture](docs/security.md).

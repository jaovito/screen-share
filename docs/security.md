# Security and privacy

M0 is local, without product authorization or media. The API/database are restricted to the host; CORS permits only the two configured local viewer addresses. CORS does not replace authentication. Do not expose this setup to the internet or LAN.

Bootstrap generates a database password (32 bytes), LiveKit key (18 bytes), and LiveKit secret (48 bytes) with node:crypto. It exclusively creates files with mode 0600 where supported and preserves existing files. On Windows, control access through the directory ACL. .env and effective LiveKit configuration are ignored by Git/Docker context and never enter the image. The template uses escaped YAML strings; LiveKit need not expand variables.

Secrets stay in backend/local configuration, never VITE variables, IPC DTOs, public URLs, logs, or bundles. DATABASE_URL is internal driver configuration containing credentials; never print it. The image receives variables at runtime without secret build args. Runtime uses unprivileged node. Smoke uses the administrative SDK only in backend for listRooms, with timeout and no content output.

The shell has one application permission for get_app_info, no shell/filesystem/HTTP plugins, and no available capture commands. CSP restricts scripts to local content, IPC, and development Vite/HMR. There is no remote navigation, auto-capture, or microphone/camera access.

Readiness fails closed when database/schema is unavailable and returns status only. The API exposes no room mutations, fake login, arbitrary token issuance, or authorization based on client-supplied identity. Preserve these boundaries when evolving the bootstrap.

Before beta: authentication, membership authorization, bounded invites, minimal scoped grants, TLS, keys outside the database, verifiable participant identity, epochs/session revocation, two-PC E2EE validation, and auditing/retention policy. The threat/key model and encoder/transport proof are in PLAN.md; never display an E2EE badge without evidence.

Never replace a window with a whole monitor during recovery or implicitly fall back to system-wide audio. Metrics must come from actual stages; presets/hypotheses are not observations. Detailed metrics remain local; support reports must be voluntary and sanitized.

## Adversarial assessments

Use ss-security-review for a scoped assessment. That skill dispatches a private independent attacker-minded reviewer, permits bounded local proofs using synthetic data and assessment-owned resources, then verifies and consolidates findings. The private prompt is not registered as a general-purpose agent. Reviewers do not edit source or attack external/shared instances; they report confirmed findings separately from unverified hypotheses and future milestone requirements. This workflow does not replace platform permissions or certify E2EE/security. See [agents.md](agents.md) for activation and limitations.

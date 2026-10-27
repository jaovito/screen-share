# Security and privacy

The private product uses authenticated accounts, approved room membership, bounded invitations, revisioned sessions and scoped short-lived LiveKit grants. Deploy behind HTTPS using [deployment.md](deployment.md). Local HTTP is restricted to loopback. CORS is not authentication; mutation routes require an exact trusted origin and a valid session cookie.

## Identity and authorization

Better Auth owns password hashing and PostgreSQL-backed sessions. Browser cookies are HttpOnly/SameSite=Lax and Secure over HTTPS. The native desktop keeps cookies in its Rust HTTP client, outside the WebView. Auth responses expose the user rather than reusable session tokens. Only configured email/password capabilities are routed. Email delivery, verification and recovery are not configured; possession of an account does not prove ownership of an email address.

Room owners create invitations with bounded expiry and uses. The database stores invitation hashes, never bearer invitation values. Acceptance creates pending membership; only the owner can approve or remove members. Pending users can inspect only their own pending status. Rooms admit at most eight members including the owner; an owner can create at most twenty rooms. HTTP bodies, authentication attempts, request durations and database statements are bounded.

Room-first transactions serialize membership and session changes. Grants require current approved membership, an active session, matching epoch/revision and acknowledged cleanup. Publisher grants permit the owner's designated screen-share video and, only when explicitly requested, screen-share audio. Viewer grants cannot publish. Grants expire after sixty seconds. Neither the grant request nor the report API accepts a caller-supplied authenticated identity.

## Revocation and content keys

Membership changes invalidate the session and block new grants. A durable outbox deletes the old RTC room with bounded retries; replacement activation waits for acknowledged cleanup. Closing is asynchronous and visible in the UI. Token expiry alone does not prove immediate revocation.

The publisher generates a fresh independent media key locally for each prepared session and confirms its distribution outside the control service. Keys stay in component/native memory and private child pipes; they never enter API requests, PostgreSQL, URLs, browser storage or diagnostic reports. Private experiment key files are optional operator tooling, not product persistence. JavaScript cannot guarantee memory zeroization, and authorized recipients can record or redistribute decrypted content.

The receiver validates its room/identity and designated publisher, requires encrypted screen-share tracks and stops on authorization or encryption failure. It can wait for the same authorized publisher to rejoin only within the current lease. It does not silently accept a replacement identity or unencrypted media. Native lease renewal runs independently of WebView timers and obtains grants through the private cookie client; stale or cancelled renewal work cannot start or renew a later sharing instance.

## Native boundaries

Capture starts only after explicit user action and Windows source selection. Recovery does not replace a window with a monitor. Audio defaults off; application loopback requires an explicit process choice and binds its PID to process creation time. System audio requires separate acknowledgement. No fallback to microphone or broader audio scope is permitted.

The desktop receiver uses the same encrypted adapter as the web player. Build-time `SCREEN_SHARE_RTC_URL` accepts origin-only WSS, or WS for loopback development; credentials, paths, queries, fragments, wildcard hosts and policy injection are rejected. Runtime CSP extends the existing policy with that exact WebSocket origin and HTTP counterpart, preserving script nonces/hashes. Self/blob worker and media sources support the E2EE worker and attached tracks. The packaged WebView uses `https://tauri.localhost`, so local UI preferences from an older HTTP origin may reset; native authentication cookies remain outside the renderer.

Tauri exposes narrow sharing, authenticated control, process-choice and signed-update commands. The control client has a fixed API origin, route/method allowlist, bounded payloads and no redirects or arbitrary frontend headers. The bundled sidecar launches without a shell, with a minimal environment and private pipes; Windows job ownership limits termination to its own child tree. Frames and PCM never cross JSON or HTTP control endpoints.

Updates are unavailable until a fixed HTTPS feed and trusted public signing key are configured at build time. The official updater verifies version-bound signatures. Installation requires explicit user confirmation, stops the owned publisher and restarts through the installer. The frontend cannot supply an arbitrary update URL, path or public key.

## Data, diagnostics and operation

Bootstrap exclusively creates private configuration files and preserves existing files. Backend credentials, database URLs, invitation values, JWTs, cookies, media keys and window titles must not appear in logs, bundles, screenshots or support reports. Frontend variables contain only public endpoints. Generated deployment configuration, binaries and private proof files are excluded from Git and Docker context.

Request logs contain only timestamp, event, request ID, method, status and duration. Readiness checks the required schema and returns status only. Client receiver reports contain bounded numeric observations, are explicitly advisory, expire after twelve seconds and remain process-local; only the current owner can read them. They do not contain media, titles or content keys, and are not durable audit evidence.

Operators must define retention and bounded maintenance for expired invitations, audit and authentication-rate records before wider deployment. Preserve backups, current membership and unfinished cleanup. No retention job or production maintenance is implicitly authorized by these documents.

## Assessment and acceptance evidence

Use `ss-security-review` for scoped security assessments. Only that skill dispatches the private independent adversarial reviewer, using synthetic data and owned disposable resources. Reviewers do not edit source or target external/shared instances. See [agents.md](agents.md) and [security-review-product.md](security-review-product.md).

Portable tests and synthetic encrypted SDK interoperability are distinct from physical Windows/GPU capture, two-PC E2EE, prolonged playback and deployment validation. See [validation.md](validation.md) for executed evidence and [PLAN.md](../PLAN.md) for acceptance criteria. Neither code review nor synthetic playback certifies endpoint security or the complete deployed system.

The explicit `?mode=experiment` interface and offline grant CLI remain bounded M1 tools. Their operator allowlist is not product membership enforcement; use real product accounts and session endpoints for the normal application. Never distribute experiment administrative credentials or private grant files.

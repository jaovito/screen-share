# Web viewer

React/Vite frontend for authenticated private rooms and encrypted reception. The shared product workspace includes account sessions, invitation requests and owner approval, session/key controls and local diagnostics. It never acquires the camera, microphone or desktop.

Run `bun install --frozen-lockfile`, `bun run bootstrap`, `bun run infra:up`, `bun run db:migrate`, then `bun run dev` from the repository root. Open `http://127.0.0.1:5173` (or `VIEWER_PORT` from `.env`). Use the same hostname for viewer/API so HttpOnly SameSite cookies work. `VITE_API_URL` is public configuration; secrets must never use `VITE_`.

Create an account and room, invite friends privately and approve their requests. The owner prepares an epoch and distributes its fresh content key outside the service before activation. Viewers enter that independent key and explicitly connect. Membership changes retire the session and require a fresh key. Browser publishing is unavailable; use the Windows desktop application.

The client lazily loads LiveKit and its actual E2EE worker. It verifies the designated room/participant/publisher, accepts encrypted selected-source tracks and stops on unknown authorization, epoch changes, expiry or transport/encryption failure. Signed grant renewal is explicit and may briefly interrupt playback. Audio has local playback controls because autoplay may be blocked.

Profiles and counters are not measured hardware support or visual latency. The advanced `?mode=experiment` page retains the bounded M1 diagnostic form. Use the repository's Bun unit/DOM, coverage, real product E2E and media interoperability runners; see [testing](../../docs/testing.md).

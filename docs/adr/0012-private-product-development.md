# Private product implementation and acceptance

Status: accepted · 2026-10-27.

## Context

The user explicitly requested implementing all remaining software after the M1 draft. The original physical-hardware advancement sequence does not prevent developing the authorized product. This host cannot execute real Windows GPU capture or a two-PC game experiment. Those tests remain mandatory evidence for acceptance and release.

## Decision

Implement authentication, private rooms, owner-approved invitations, scoped sessions, the desktop controller, diagnostics and distribution as real connected product behavior. Preserve bounded native media ownership, explicit source/audio consent and keys outside the service. Use an established authentication library rather than implementing password/session cryptography. Use existing PostgreSQL transactions for membership and increasing media epochs. Revoke/retire the old RTC session before activating replacement media; short JWT TTL alone is not revocation.

The web and desktop applications share concrete authentication/room UI and control lifecycle code. Only the Windows desktop may invoke the owned native publisher. Credentials and content keys are never process arguments, URLs, telemetry or persisted browser state. A fixed owned child process isolates native driver watchdog termination from the desktop application.

Signed short-lived grants must be re-authorized for long sessions. Where the SDK has no safe public token replacement API, explicitly reconnect with a fresh grant and re-verify SFU identity, permissions and E2EE while retaining the same selected capture item. Document any interruption. A changed epoch requires stopping the old session and distributing a fresh independent key; keys are never rewrapped only under the old shared secret.

## Alternatives and consequences

Stopping implementation at M1 contradicts the current user instruction. Pretending physical tests passed contradicts the evidence contract. Development may therefore continue while acceptance remains incomplete. Signing credentials, an actual TLS hostname and access to physical Windows hardware remain operator-dependent; unsigned development artifacts and deployment instructions must be clearly identified.

Implementation and tests must reject unauthorized requests, stale epochs, replayed/revoked invitations and keys, unexpected media and unavailable authorization. Diagnostics use actual counter deltas, identify unavailable inputs and never infer visual latency from RTT. Final documentation distinguishes implemented behavior, executed tests and unexecuted hardware/release criteria.

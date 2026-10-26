# Control separate from media

Status: accepted for M0 · 2026-10-26.

## Context

Authorization must not transport frames; healthy HTTP does not establish working RTC.

## Decision

Hono/PostgreSQL for control, LiveKit as SFU. Native Windows publisher, web viewer. One publication layer is a beta hypothesis to prove.

## Consequences

M0 publishes no audio/video, room tokens, or encryption. TURN/revocation need their own design and tests.

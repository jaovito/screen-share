# Desktop receiver security review

Date: 2026-10-27. Scope: ADR 0013, shared receiver extraction, native desktop
adapter, exact-origin CSP and release RTC configuration. This is an implementation
review, not certification of endpoint security or deployment readiness.

The coordinator and the independent private reviewer dispatched through
`ss-security-review` inspected the changed source, contracts, native cookie transport
and pinned Tauri CSP implementation. Attacker models included an untrusted renderer,
an authenticated participant supplying invalid media/grants, and malformed public
build configuration. The independent review was read-only; no external services,
shared databases, personal media or real credentials were accessed.

No confirmed actionable vulnerability was established. The shared media runtime is
unchanged from the previously tested browser receiver except for its public input
type. The shared room UI binds grants to the current session, epoch, participant,
publisher and viewer role. Reception rejects plaintext/unexpected tracks and releases
workers, sinks and timers on failure. Native cookies remain in Rust, and reusable
authentication tokens are stripped before IPC responses.

The new policy validates a fixed origin, rejects wildcard/control/credential/path
injection and insecure remote WS, preserves script nonce/hash directives and allows
only the configured WebSocket origin plus its HTTP counterpart. Pinned Tauri source
uses the runtime configuration while preparing asset CSP. Native policy tests cover
these constraints; compilation alone does not prove enforcement in WebView2.

Actual Windows secure-context/E2EE support, enforced CSP, decoded playback and cleanup
require the Windows runtime test. Physical capture, two-PC/TURN connectivity and
prolonged acceptance remain distinct gates. See [validation.md](validation.md) for
execution evidence rather than treating this static review as a runtime result.

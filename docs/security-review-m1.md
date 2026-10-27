# M1 control and browser receiver security assessment

Assessment date: 2026-10-26. Scope: the first M1 operator/grant/contracts/browser receiver and portable lifecycle/queue/access-unit implementation, before native encoder/transport composition. The independent reviewer was dispatched through ss-security-review with its private adversarial prompt. It could inspect source and execute bounded synthetic proofs, without source changes, real configuration/secrets, shared services, or personal media.

## Findings and remediation

### SDK cleanup exception could skip other resources

Confirmed low-severity robustness failure. During receiver stop, an exception from SDK track detach/stop could abort room disconnection and worker termination after the stopped flag was set, preventing a retry. A temporary fake-SDK fault-injection proof observed no disconnect, worker termination, or track stop after a throwing detach. No remotely triggerable exploit was established.

Remediation: cleanup actions have independent best-effort guards, preserving subsequent room/worker/video release attempts and idempotency. Regression tests inject throwing detach and stop operations and assert remaining resources are still cleaned up. The service exposes only typed failure state and suppresses raw SDK logging.

### Lease expiration during blocking native preparation

Static integration risk, not a demonstrated current product exploit: a caller-provided timestamp could become stale while authorization, encrypted preparation, or native startup was in progress. The native sharing composition was not yet wired.

Remediation before integration: SharingSession now owns an injected trusted monotonic clock; verified lease deadlines share its origin. It rechecks fresh time around blocking operations, fails closed on clock regression, prevents capture opening after expiry, and releases a startup that crosses its deadline before the driver may forward a frame. Eight fake-clock regressions cover expiration during authorization/preparation/start/resume/pause, stale renewal gaps, and clock regression. Driver contracts require bounded verified snapshots and access checks before frame forwarding; this is not a new server-side revocation implementation.

## Inspected controls and limits

No remote authorization bypass was confirmed in the implemented offline operator/browser receiver paths. The reviewer found explicit participant allowlists, least-privilege role/source grants, consent, connected room/local identity validation before subscription, designated encrypted-track restriction, no automatic reconnect, and same-source recovery invariants.

The review does not certify the product or cryptographic system. It did not execute Windows capture, native hardware encoding, native SDK interoperability, strict revocation, or prolonged/two-PC tests. New native encoder/transport code and its composition require separate review after implementation. The reviewer cleaned its temporary proof files. See validation.md for coordinator-executed regression and browser evidence, and PLAN.md for open advancement gates.

## Native and Windows composition follow-up

A second independent static pass covered the native SDK adapter, WGC/converter/MFT buffers and ownership. It found no confirmed remote authorization/privacy bypass or unsafe span violation. Two low-severity policy/cleanup issues were corrected: native expiry preserves subsecond remaining lifetime before monotonic projection, and asynchronous close retains pending tasks/caches terminal failures so retries cannot falsely report successful cleanup. Network-free regressions cover both boundaries.

A final static pass inspected the Windows utility, current-user key export, bounded worker handoff and watchdog. It identified a grant-loading size-check/read race: the utility now opens once, checks the same handle for a regular file, and limits UTF-8 reading to 12,001 bytes before rejecting overflow. A portable synthetic-file regression executes this boundary. To avoid depending on potentially stuck DLL teardown, watchdogs now force termination through the current-process pseudo-handle only; an owned-child Windows regression is configured. No API for terminating other processes exists.

The new key exporter has real Windows-only tests for CNG-generated keys, protected single-current-user DACLs, exclusive creation, shared-delete lifetime and unsafe paths. These require the actual Windows CI/runtime and were not executed by the reviewer. Native-to-browser SDK encryption interoperability was subsequently executed by the coordinator using synthetic H.264; it does not establish Windows capture, hardware behavior, strict revocation or two-PC privacy. Final hardware validation remains mandatory.

# Product security review

Date: 2026-10-27. Scope: the uncommitted product implementation following the M1 draft, including real authentication, private rooms, invites, epochs, cleanup, the native cookie proxy, shared UI lifecycle and owned desktop sidecar. The user authorized implementation/remediation. The `ss-security-review` skill dispatched an independent adversarial reviewer; it did not authorize external assessment.

## Confirmed finding and remediation

A medium availability issue allowed an authenticated owner to repeatedly prepare replacement candidates while a session was already preparing. A bounded synthetic service proof accepted four calls, advanced to epoch 4, and queued three never-activated RTC cleanup jobs. No overload, external service or real database was exercised. The global cleanup dispatch rate could not keep up with the allowed repeated preparation rate.

The service now rejects prepare while preparing, active or closed. Room creation is serialized on the authenticated owner row and capped at twenty rooms, preventing concurrent requests consuming the same final slot. Regression coverage verifies concurrent preparation produces one candidate, repeated preparation produces no additional cleanup jobs, and concurrent creation at the room limit admits one final room. No limit/authorization/audit rule was disabled.

## Reviewed controls and limits

The independent pass found no additional confirmed IDOR, auth-cookie disclosure or content-key-to-service path. It traced approved/owner checks, hashed/revocable invitations, room-first locks, session epoch/revision checks, cleanup-before-activation, scoped short-lived grants, native private cookie storage, fixed route/origin policies, memory-only keys, UI media teardown, designated encrypted audio/video sources and fixed sidecar/job ownership.

Revocation is an explicit asynchronous closing/cleanup transition. Membership changes immediately block new grants and invalidate the candidate. The outbox removes the old RTC room; replacement activation remains blocked until cleanup is acknowledged. A sixty-second JWT is not an independent strict-revocation mechanism. Authorized publishers/recipients can still record or redistribute content, and compromised endpoints remain outside E2EE's guarantee.

The reviewer ran only a small synthetic service proof from a temporary directory with environment autoload disabled; it used no network/database, real secrets, media, shared services or external targets. The proof was removed and tracked files were unchanged. Coordinator validation uses separately owned disposable resources. This is neither certification nor physical Windows/E2EE acceptance.

Invite, audit and authentication-rate records require an operator retention policy before wider deployment. Keep audit evidence for an explicit retention period and remove expired records in bounded maintenance batches with backups; do not delete current membership or unfinished cleanup. No maintenance job has been scheduled or run against the development or production database by this review.

## Second independent pass

The read-only second pass reviewed the native authorization supervisor, cancellation/nonces, logout suspension, fixed cookie proxy, private report authorization/cache and receiver transmission. It confirmed no new actionable issue. Report reads/writes remain bound to the current approved roster/session under the room lock; client values are explicitly advisory and do not grant access or drive publisher adaptation. No build, real credential, shared/external service or proof artifact was used by this pass. Physical platform/network timing and end-to-end revocation remain separate acceptance work.

## Same-source recovery pass

The final targeted independent static review found no actionable issue in the new recovery boundary. It checked immutable picker-item/session ownership, session-total retry limits, source-close/pause/revocation gates, generation-scoped fault reports, synchronized video enqueue, old-resource retirement and the required fresh parameter-set IDR. Recovery neither extends authorization nor changes epoch/key/source. Cleanup errors remain terminal. No builds, test execution, hardware, credentials or external/shared services were used by the reviewer; real driver/resource behavior and two-PC revocation timing remain separate acceptance evidence.

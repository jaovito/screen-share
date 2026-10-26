---

name: ss-architecture
description: "Design or review cross-cutting decisions for this screen-sharing system, including contracts, hexagonal boundaries, sessions, and control/media tradeoffs."
---

# Make an evidence-based architecture decision

Read [PLAN.md](../../../PLAN.md), [architecture](../../../docs/architecture.md), and relevant [ADRs](../../../docs/adr). Confirm actual state in code before proposing evolution. For authorization/key decisions, read [security](../../../docs/security.md).

Frame the problem by scenario and constraint: initiator, changed state, tolerated failure, and observable success. Identify the authorized milestone; M1 proves viability without anticipating all of M2–M5.

Map dependencies and data/resource ownership. Preserve pure domain rules, small ports, and edge composition. Control carries commands/metadata; media stays in the native/RTC path. Evaluate queue/buffer/thread/SDK costs instead of assuming hexagonal architecture requires an interface per function.

Compare plausible alternatives by current complexity, future change, recovery, privacy, operational cost, and validation method. Uncertain versions/APIs/capabilities require current primary sources. Separate documented support from what the experiment must establish. Do not change Node/Bun, codec, SFU, or topology on preference alone.

For a durable decision or reversal of an accepted decision, write a short sequential ADR in docs/adr: context/problem, decision/status, alternatives/rationale, consequences, validation, and open questions. Use the next free number; do not rewrite historical evidence as a new result. Update PLAN.md only when scope or criteria actually change. Write these documents in English.

Deliver a recommendation, affected dependencies/contracts, implementation sequence, and advancement gate. Analysis-only requests do not authorize implementation. Explain a small local decision directly rather than creating an obligatory ADR.

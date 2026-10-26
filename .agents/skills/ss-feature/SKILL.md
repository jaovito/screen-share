---

name: ss-feature
description: "Implement a feature or fix a bug in this repository, crossing only necessary boundaries and preserving PLAN.md contracts and milestone gates."
---

# Implement a product change

Read [AGENTS.md](../../../AGENTS.md) and identify the requested milestone/behavior in [PLAN.md](../../../PLAN.md). Consult [architecture](../../../docs/architecture.md), [frontend](../../../docs/frontend.md), or [testing](../../../docs/testing.md) as needed. This skill does not authorize starting an adjacent milestone.

Trace the actual path from input to effect. Reproduce a bug or demonstrate its cause before fixing it; derive observable acceptance criteria for a feature. Separate existing behavior, intended changes, and unproven assumptions. Clarify only information that blocks a material decision.

Choose the smallest cohesive change: domain rules, application coordination, adapter I/O, edge composition. Create abstractions for real boundaries, not universal repositories, adjacent refactors, or speculative folders. Simple changes do not require a design document. Use ss-architecture before changing a boundary/product guarantee.

- HTTP: update validated contracts, application/adapters, and affected consumers; never expose Drizzle entities.
- IPC: update Rust/TS representations and the compatibility fixture, preserving the Windows gate.
- SQL: generate a versioned migration using the existing apps/control-api/package.json script; review SQL, journal, and snapshot. Define constraints/transactions and test before/after state in a disposable database. Applied history is immutable.
- UI: keep ownership in its feature, a small public API, error/cancellation states, and manifest-based styles. Do not advertise future capabilities as available.

Validate behavior with regressions that fail before the fix where feasible. Include applicable rejections, limits, concurrency, and cleanup; do not test implementation details merely to increase coverage. Use ss-verify to select/execute checks and ss-media-spike for media work. Update documentation/ADRs only when operation, behavior, or decisions change. Write documentation, code, comments, and developer-facing test descriptions in English; preserve existing product UI text unless requested otherwise.

Deliver implemented behavior, key files, checks, and pending gates. Interfaces/stubs do not complete the next milestone.

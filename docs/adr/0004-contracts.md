# Transport contracts

Status: accepted for M0 · 2026-10-26.

## Context

Reusing ORM/UI entities as domain entities creates coupling.

## Decision

Zod schemas/DTOs in packages/contracts; domain keeps pure rules. Small manual Rust/TS IPC contract, versioned fixture, tests on both sides.

## Consequences

The fixture detects basic field/value drift. Larger changes may justify binding generation, without a broad M0 pipeline.

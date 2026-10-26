# Safe local environment

Status: accepted for M0 · 2026-10-26.

## Context

Hosts/containers have different addresses and dependencies.

## Decision

Compose for PostgreSQL/LiveKit; host API by default, optional app profile. Loopback publication, PostgreSQL 17 PGDATA, generated local secrets, a fresh migrator per stack:up.

## Consequences

This is not a LAN/public deployment. Smoke authenticates control; M1 must still prove ICE/NAT/UDP/media across two PCs.

## Observed command adjustment

pnpm doctor is reserved by pnpm 10.20.0 and does not invoke the identically named project script. The project diagnostic used pnpm run doctor, without global wrappers or manager modifications. This records the initial setup; later manager changes are in ADR 0007.

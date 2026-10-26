# Hexagonal architecture

Status: accepted for M0 · 2026-10-26.

## Context

Native capture, transport, and persistence have distinct requirements.

## Decision

Pure domain, application with small ports, edge adapters; API as a modular monolith. Composition lives in the API index and Tauri shell.

## Consequences

Unavailable adapters return typed errors. Do not add media dependencies without the M1 proof.

# Contratos de transporte

Status: aceito para M0 · 26/10/2026.

## Contexto

Reutilizar entidades ORM ou UI como domínio cria acoplamento.

## Decisão

Schemas Zod/DTOs em packages/contracts; domínio mantém regras puras. IPC manual pequeno em Rust/TS, fixture versionada e teste nos dois lados.

## Consequências

A fixture detecta drift de campos/valores básicos; alterações maiores podem justificar geração de bindings, sem pipeline amplo no M0.

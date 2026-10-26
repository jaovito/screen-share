# Ambiente local seguro

Status: aceito para M0 · 26/10/2026.

## Contexto

Hosts e containers têm endereços e dependências diferentes.

## Decisão

Compose para PostgreSQL/LiveKit; API no host por padrão e perfil app opcional. Loopback, PGDATA de PostgreSQL 17, segredo local gerado, migrador novo em cada stack:up.

## Consequências

Ambiente não é deployment LAN/público. Smoke autentica controle; M1 ainda deve provar ICE/NAT/UDP e mídia em dois PCs.

## Ajuste de comando observado

`pnpm doctor` é um comando nativo reservado do pnpm 10.20.0 e não chama scripts homônimos. O diagnóstico do projeto é executado por `pnpm run doctor`, sem wrappers globais nem modificação do gerenciador.

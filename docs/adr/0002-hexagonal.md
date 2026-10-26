# Arquitetura hexagonal

Status: aceito para M0 · 26/10/2026.

## Contexto

Captura nativa, transporte e persistência têm requisitos distintos.

## Decisão

Domínio puro, aplicação com portas pequenas e adapters nas bordas; API como monólito modular. Composição no index da API e no shell Tauri.

## Consequências

Adapters indisponíveis retornam erros tipados. Não adicionar dependências de mídia sem a prova M1.

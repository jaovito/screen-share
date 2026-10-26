# Organização por feature, scripts TypeScript e política de testes

Status: aceito por solicitação do usuário · 26/10/2026.

## Contexto

O usuário pediu adotar as convenções de organização/legibilidade e testes do projeto local `~/www/truco`, e substituir scripts MJS por TypeScript. O projeto já possui Node LTS, pnpm, Vitest e Rust/Tauri.

## Decisão

Adotar `app/features/shared`, APIs públicas por feature, testes/estilos próximos, manifesto CSS por app, limites de tamanho e verificação de imports com Oxc. Configurar Biome com 2 espaços, largura 100, aspas simples e trailing commas, e documentar a separação de blocos lógicos por linhas em branco. Manter API hexagonal e Rust puros.

Executar scripts autorais `.ts` com o Node 24 já fixado, restringindo-os a sintaxe apagável e mantendo typecheck próprio. Preservar pnpm e Vitest para evitar um segundo gerenciador/runtime/runner sem necessidade; não é necessário Bun para esse requisito.

Configurar Vitest/Happy DOM/React Testing Library e cobertura V8 de pelo menos 80% de linhas e funções por arquivo, com inventário de fontes. PostgreSQL é descartável nos testes. Playwright usa builds de produção, API real e Chromium desktop/mobile em portas isoladas. O check completo inclui cobertura e passa a exigir Docker; E2E continua separado.

## Consequências

Documentos e regras centrais: `AGENTS.md`, `docs/frontend.md`, `docs/testing.md`. Estilos de profile/status e diagnóstico IPC pertencem às features; tema e componentes visuais comuns permanecem em packages/ui. Não são copiadas regras de gameplay, PixiJS, autenticação ou stack exclusiva do Truco.

Os três entrypoints CLI mínimos da API ficam fora do denominador; todo seu comportamento foi extraído para serviços medidos em `src/runtime`. Relatórios e traces são locais/artefatos de CI, com código de tooling preservado no Git. Coverage TS, E2E web e check Rust não comprovam captura, E2EE ou shell Windows.

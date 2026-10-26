# Testes, cobertura e desenvolvimento

A política adapta as práticas de `~/www/truco` à stack do projeto. Bun Test nativo (`bun:test`) é o único runner unitário/DOM/integração; Playwright cobre navegador; Rust usa cargo test. Vitest e seu provedor de cobertura foram removidos após a avaliação da ADR 0008. Use `bun run test` para coordenar backend/DOM isolados. Uma chamada `bun test <arquivo>` é útil para seleção direta; testes DOM precisam de `--preload ./tooling/tests/setup-dom.ts`, e testes SQL exigem banco descartável pelo runner.

| Comando                           | Escopo                                                              |
| --------------------------------- | ------------------------------------------------------------------- |
| `bun run lint`                    | Biome lint + fronteiras de arquitetura                              |
| `bun run format` / `format:check` | Formata / verifica sem alterar                                      |
| `bun run typecheck`               | Contratos, apps, testes DOM/API, scripts TS, tooling, configs e E2E |
| `bun run test` / `test:unit`      | Unitários e DOM, sem Docker                                         |
| `bun run test:integration`        | Migrations/constraints/readiness com PostgreSQL descartável         |
| `bun run test:persistence`        | Dados e histórico de migrations após reinício do banco descartável  |
| `bun run test:coverage`           | Unitários, DOM e integração SQL com metas por arquivo e inventário  |
| `bun run test:e2e:install`        | Instala Chromium gerenciado pelo Playwright                         |
| `bun run test:e2e`                | API/DB reais e previews de produção isolados, desktop e mobile      |
| `bun run check:ts`                | Lint, tipos, arquitetura, unitários/DOM e builds; sem Docker        |
| `bun run check`                   | Check TS, Rust portável e cobertura completa; requer Docker         |

## Organização e comportamento

Testes de frontend ficam ao lado das páginas/hooks/serviços que exercitam. Não exigir teste isolado para componente decorativo já coberto pela composição. Regressões da API ficam em `apps/control-api/test`; `.integration.test.ts` seleciona casos de banco. Testes de regras de tooling ficam em `tooling`. E2E ficam em `tests/e2e/<feature>/*.e2e.ts`; suporte compartilhado só é criado com necessidade real.

Casos atuais incluem catálogo/validação, liveness versus readiness, configuração saneada, banco indisponível, SQL repetido, constraints, reconexão, retries limitados, encerramento do servidor, smoke de controle, loading/retry/erro/cleanup do viewer e IPC indisponível/inválido no desktop. Relógios falsos evitam esperas reais em testes de timeout. Rede/banco reais têm prazos limitados.

E2E usa banco descartável, portas livres e processos exclusivos, sem reutilizar servidores existentes ou tocar no banco de desenvolvimento. O fluxo principal consulta a API real, aplica migrations reais e exibe os oito perfis. Cenários de erro interceptam somente as requisições do teste para provocar 503/contrato inválido; não são anunciados como testes de rede de mídia. A prévia web do desktop não comprova shell Windows ou captura.

O runner E2E constrói as interfaces com URL pública de API própria. `reuseExistingServer: false` evita usar outro aplicativo por engano. Traces ficam retidos em falha; HTML em `playwright-report`, screenshots em `test-results`. `bun run test:e2e -- --project=chromium` seleciona o projeto desktop. As capturas de sucesso permitem revisão visual além das asserções geométricas.

## Cobertura obrigatória

Mínimo: **80% de linhas e 80% de funções por arquivo executável**, configurado em `bunfig.toml` e conferido explicitamente pelo parser LCOV em `tooling/coverage/lcov.ts`. A conferência usa contadores exatos antes de arredondar e verifica cada ocorrência de arquivo em cada suíte. Uma média alta não compensa um arquivo abaixo da meta. Statements e branches não são anunciados como medidos por este runner; casos de decisão continuam exigidos pelos testes/revisão. Casos críticos continuam obrigatórios independentemente da porcentagem.

O runner limpa `/coverage`, cria PostgreSQL exclusivo e mede backend/SQL em um processo e DOM em outro, ambos com `--isolate` por arquivo. O inventário abrange todas as fontes `apps/*/src` e contratos; o analisador de arquitetura também é medido; o inventário rejeita módulos executáveis ausentes do relatório, incluindo fontes sem imports em testes. Relatórios: texto e LCOV nativos por suíte, LCOV agregado, JSON summary e HTML de sumário (`coverage/index.html`) com linhas não cobertas. Arquivos sem funções próprias aparecem como — no HTML, sem inventar funções para contar. Não se compara esse percentual diretamente ao V8/Vitest, pois os contadores são diferentes. Playwright e Rust não são somados a esse percentual.

Exclusões explícitas: testes/fixtures de testes, declarações TypeScript, configs/tooling de execução, e os três entrypoints mínimos `src/index.ts`, `src/migrate.ts`, `src/smoke.ts` da API. Eles somente compõem configuração, chamam serviços e atribuem código de saída. **Todo comportamento** de servidor, migração e smoke foi separado em `src/runtime` e permanece medido; os entrypoints de frontend também são medidos. Não mover comportamento para wrappers ou qualquer pasta excluída para elevar cobertura. Scripts de operação não são denominador de produto; são typechecked e seus fluxos são verificados por bootstrap/doctor/integração/E2E.

`tooling/coverage` permanece versionável: somente relatórios de cobertura da raiz/apps/packages são ignorados. O inventário possui regressão que reprova fonte ausente e aceita arquivos só de tipos. Nunca usar testes que apenas importam módulos para aumentar percentual, baixar metas ou adicionar exclusões silenciosas.

## CI e limites

Linux executa checks TS, cobertura com banco descartável, persistência e E2E Chromium desktop/mobile. Relatórios são anexados como artifacts, inclusive falhas. Jobs separados mantêm Rust portável, shell Windows e imagem/Compose. Requisitos Docker/Chromium ausentes falham com mensagem; não geram testes ignorados para obter verde.

O CI está configurado, mas só sua execução remota pode confirmar resultados no provedor. O gate Windows e a prova de mídia continuam pendentes. Cobertura TypeScript não afirma cobertura numérica Rust, validação WebView2, encoder, WebRTC ou E2EE.

A migração para Bun Test preserva o gate por arquivo e os relatórios. Regressões verificam reprovação de módulo abaixo de 80% mesmo com média global alta, contadores inválidos e o limite antes de arredondamento. Também foi verificado o caminho negativo do runner nativo com meta temporária de 100%, que deve sair com código não zero. Vite e Playwright usam execução explícita `bun --bun`; a API dos E2E permanece em Node para validar o runtime publicado. Ver ADRs 0007 e 0008.

## Equivalência e isolamento no Bun Test

As suites Node e DOM são descobertas em `scripts/test-suites.ts`; arquivos `.integration.test.ts` são incluídos somente com banco descartável. `bun run test` constrói contratos e executa 35 testes unitários/DOM; `test:coverage` inclui a integração SQL, totalizando 36. Preloads/ambientes não são misturados; cada arquivo usa `--isolate` para impedir que mocks de módulo ou globais atravessem fronteiras.

Mocks usam `mock`, `mock.module` e `spyOn`. Mocks de módulo são registrados antes do import dinâmico do módulo exercitado. Timers usam APIs síncronas `jest` do próprio Bun e drenagem explícita de microtasks; não há shim de Vitest. Testes de montagem usam um identificador de módulo distinto para o caso de raiz ausente, sem depender de `vi.resetModules`. O preload DOM registra Happy DOM antes de importar React Testing Library e faz cleanup/restauração de spies após cada teste.

A migração não foi apresentada como ganho adicional de velocidade: os tempos locais ficaram equivalentes, e o fluxo nativo inclui build de contratos/três testes adicionais. A vantagem é remover Vitest e seu provedor, mantendo comportamento e política de qualidade. Typecheck é obrigatório porque execução de TypeScript não valida tipos.

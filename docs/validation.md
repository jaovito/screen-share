# Evidências de validação — M0

Data: 26/10/2026. Máquina: macOS arm64; Docker Engine 29.8.2 via OrbStack, Compose v2. O relatório registra execução local; nenhum workflow remoto foi executado e nenhum código foi publicado.

## Resultados

| Verificação executada                                        | Resultado                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                             | Passou, cinco pacotes workspace; lockfile gerado pelo pnpm 10.20.0                                                                                                  |
| `cargo generate-lockfile`                                    | Passou, Cargo.lock real incluindo o shell                                                                                                                           |
| `pnpm bootstrap` repetido                                    | Passou; comparação byte a byte confirmou preservação dos dois arquivos locais                                                                                       |
| `pnpm run doctor` com Node 24.22.1                           | Passou; Node/pnpm/Rust, configuração e Compose disponíveis; portas ocupadas reportadas como informação                                                              |
| `pnpm check` com Node 24.22.1 / Rust 1.99.1                  | Passou: Biome, tipos, sete testes TS/HTTP/contrato, builds API/viewer/UI desktop, rustfmt/clippy e três testes Rust portáveis                                       |
| `pnpm test:integration`                                      | Passou em PostgreSQL 17.11 descartável: readiness 503 antes da migration, migration real/reexecução, constraints, conexão nova e 503 quando histórico fica pendente |
| `pnpm test:persistence`                                      | Passou: migration e registro real de rooms preservados após reinício de PostgreSQL com volume descartável                                                           |
| `pnpm infra:up` + `pnpm db:migrate`                          | Passou: banco e SFU iniciados, migration aplicada no banco local                                                                                                    |
| Compose `config --quiet`                                     | Passou sem imprimir configuração resolvida                                                                                                                          |
| `pnpm stack:up` repetido                                     | Passou: imagem multi-stage, runtime sem privilégios, migrador novo em cada execução, API pronta após sucesso                                                        |
| `pnpm smoke` do host e smoke compilado dentro da imagem      | Passaram: HTTP, catálogo, readiness/migrations e listRooms autenticado no LiveKit, com timeout; sem conteúdo de salas/credenciais na saída                          |
| `pnpm dev` no host                                           | Passou com portas temporárias livres para API/viewer; readiness real 200 e HTML disponível; processos temporários encerrados                                        |
| `cargo check --locked -p screen-share-desktop --all-targets` | Passou no macOS, incluindo configuração Tauri e permissions                                                                                                         |
| `cargo test --locked -p screen-share-desktop --lib`          | Passou no macOS: fixture serializada IPC compatível com contrato TS                                                                                                 |
| Viewer no navegador                                          | Passou: oito perfis, retry, indisponibilidade com request abortado, erro com resposta inválida e recuperação com API real                                           |
| Viewer em 1280px e 390px                                     | Sem overflow horizontal; screenshots inspecionadas em `docs/evidence`                                                                                               |
| Prévia web do desktop                                        | Passou: ausência de IPC explicitada e transmissão desabilitada                                                                                                      |
| Git/contexto Docker                                          | `.env`, LiveKit efetivo, dependências, target e artefatos temporários ignorados; sem remote/push/deploy                                                             |

O Node original do host era 24.11.0. Os primeiros checks rodaram nele; a verificação agregada final foi repetida em Node 24.22.1 obtido temporariamente em `/tmp` e conferido pelo SHASUMS256 oficial, sem alterar a instalação global. A imagem usa Node 24.22.1.

## Ajustes encontrados e corrigidos

- Hono retorna um tipo que também admite HTTP/2: encerramento usa narrowing para métodos específicos HTTP/1.
- Refinamentos de URL inválida precisam retornar falso, sem deixar exceções de URL escaparem da validação saneada.
- O shell Tauri precisa de PNG além do ICO para a checagem no macOS; os dois assets originais foram adicionados.
- Verificação de perfis rejeita dimensões incoerentes e itens duplicados.
- Artefatos gerados pelo browser/Tauri ficam fora do lint de fontes e ignorados no Git; checks das fontes permanecem ativos.
- `pnpm doctor` é reservado pelo próprio pnpm 10.20.0. O diagnóstico do projeto é `pnpm run doctor`; não foi instalado wrapper global.
- Portas 5173, 5174 e 3001 já eram usadas por outros projetos. Nenhum desses processos foi encerrado. O `.env` local usa `VIEWER_PORT=5175` e CORS correspondente; os testes do modo host alocaram portas temporárias livres.

## Limites e gates pendentes

- **Windows 11 x64 não disponível neste host:** build/check/execução do shell, permissões em runtime, teste de IPC no Windows e bundle NSIS ainda precisam executar nesse sistema. O workflow Windows está configurado, mas não foi rodado aqui.
- **GitHub Actions não executado:** jobs Linux, Rust, Windows e Compose estão versionados; seus resultados remotos continuam pendentes.
- **Mídia fora de M0:** não houve captura WGC, D3D11, encoder, transporte WebRTC de mídia, áudio, prova ICE entre PCs, autenticação de produto ou E2EE. LiveKit listRooms comprova somente conectividade/autenticação do controle.
- Nenhum instalador assinado, domínio, TLS público, TURN ou deployment LAN/cloud entregue.

## Imagens OCI observadas

- `postgres:17.11-bookworm`: `sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27`.
- `livekit/livekit-server:v1.13.11`: `sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20`.
- `node:24.22.1-bookworm-slim`: `sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`.

As tags usadas são concretas; os digests registram o pull desta execução. Não armazenar credenciais junto a essas evidências.

## Próximo passo

Validar o gate Windows do M0. Depois, iniciar M1: WGC → D3D11 → H.264 por hardware → LiveKit/WebRTC, com dois PCs, métricas reais, preservação da fonte ao Alt+Tab e prova explícita de E2EE conforme PLAN.md.

## Atualização: Tailwind compartilhado

Tailwind CSS e `@tailwindcss/vite` 4.3.3 configurados no viewer e desktop, com tokens/estilos centralizados em `packages/ui` e lockfile atualizado. `pnpm check:ts` passou (tipos, sete testes e builds); após organizar os seletores CSS, `pnpm exec biome check .` passou sem avisos e os dois builds de frontend foram repetidos com sucesso.

As prévias Vite foram reiniciadas para carregar o plugin novo. No navegador, utilities `min-h-screen`, `bg-background`, `text-foreground` e `mt-6` geraram as propriedades esperadas; em 1280px e 390px não houve overflow horizontal. O tema escuro foi preservado. A prévia desktop mantém a transmissão desabilitada. Esta alteração não modifica Rust ou recursos de mídia.

## Atualização: convenções do Truco e ferramentas de desenvolvimento

Regras de organização/legibilidade adaptadas de `~/www/truco` para `AGENTS.md`, `docs/frontend.md` e `docs/testing.md`, com decisão registrada na ADR 0006. Frontends reorganizados em app/features, APIs públicas por feature, hooks/services próximos e estilos exclusivos dentro da feature. Tokens/estilos realmente compartilhados permanecem em packages/ui. Biome passou a usar largura 100, aspas simples, 2 espaços e trailing commas, preservando separação entre blocos lógicos.

Todos os scripts autorais MJS foram substituídos por TypeScript executado no Node 24; não há JS/MJS/CJS autoral restante. Tipagem estrita inclui scripts, tooling, configs, testes DOM/API e E2E. pnpm e Vitest foram preservados; não foi necessário adicionar Bun.

Resultados locais finais desta atualização:

- Typecheck completo passou, incluindo execução com Node 24.22.1; Biome e check de arquitetura passaram.
- Suíte completa de cobertura: **33 testes**, todos aprovados, com **98,70% de linhas** e **96% de funções** no agregado. Todos os arquivos medidos cumprem o gate de **80% por arquivo**. O inventário confirmou **23 arquivos executáveis de produto** presentes no relatório; o analisador de arquitetura também é medido.
- Regressões de tooling confirmam rejeição de imports privados/ciclos, ausência de fontes em cobertura e regras reais de Biome para globais/hooks. A fixture de Biome usa arquivo exclusivo temporário, sem sobrescrever arquivos existentes e com limpeza garantida.
- Os **6 E2E** passaram em Chromium desktop/mobile, com API e PostgreSQL reais descartáveis, migrations e previews de produção isolados. Cenários de falha usam interceptação explícita; o caso principal usa HTTP/DB reais. Capturas desktop/mobile do viewer e desktop preview foram inspecionadas visualmente, sem distorções/overflow.
- Bootstrap/doctor TypeScript passaram com configuração local preservada. `check:rust` passou: fmt, clippy e três testes portáveis.
- Script TypeScript de persistência passou; migrations e registro de rooms sobreviveram ao reinício do container descartável. Instalação com lockfile congelado passou.
- Build multi-stage da imagem da API passou após a reorganização dos serviços e atualização das dependências de testes.
- CI Linux agora exige cobertura e E2E, e publica relatórios/traces como artifacts. Execução remota de CI permanece não verificada; shell Windows continua pendente.

Relatórios locais: `coverage/index.html`, `coverage/lcov.info`, `coverage/coverage-summary.json`, `playwright-report/index.html` e screenshots de sucesso em `test-results`. Nenhum relatório é código versionado. O helper `tooling/coverage/inventory.ts` permanece incluído no Git/lint.

As exclusões de cobertura são documentadas em `docs/testing.md`: wrappers CLI mínimos e infraestrutura de execução não entram no denominador de produto; servidor, migration e smoke executáveis foram separados em runtime e continuam medidos. Cobertura TS não é cobertura Rust nem evidência de mídia/E2EE.

## Atualização: adoção de Bun no desenvolvimento

Bun **1.4.3** adotado como gerenciador/workspaces e runtime das ferramentas após avaliação solicitada pelo usuário. A ADR 0007 e `docs/benchmarks/bun-2026-10-26.json` registram os dados.

Benchmark local macOS arm64, mesmos 32 testes Vitest 5.0.5, três execuções alternadas, tempo total incluindo startup e sem limpar caches:

- Node 24.22.1: 3,344s / 1,800s / 1,977s; mediana **1,977s**.
- Bun 1.4.3: 1,718s / 0,802s / 0,916s; mediana **0,916s**.
- Cerca de **54% menos tempo**, aproximadamente **2,16x** neste cenário. Os workers foram confirmados como Bun por `process.execPath` e `process.versions.bun`; o ganho não foi inferido só pelo comando pai. Amostra local, sem promessa universal.

Validações após a adoção:

- `bun install --frozen-lockfile` e `bun run check:ts` passaram também em cópia limpa sem node_modules, `.env`, caches/links pnpm ou artefatos de build anteriores. O lockfile foi gerado pelo Bun migrando o lockfile real anterior; manifests/lockfile pnpm foram removidos.
- `bun run test:coverage` passou: **33 testes**, **98,70% linhas**, **96% funções**, todos os arquivos acima do gate de 80%; inventário de 23 fontes executáveis de produto confirmado. A rejeição também foi comprovada: meta temporária de 100% causou erro e saída não zero, sem mudar a política permanente ou os relatórios oficiais.
- `bun run test:e2e` passou: **6 cenários**, Chromium desktop/mobile, previews Vite e runner Playwright sob Bun, API compilada sob **Node 24.22.1** e PostgreSQL descartável.
- `bun run dev` passou com API de desenvolvimento e viewer em portas temporárias isoladas. Bootstrap/doctor passaram; diagnóstico distingue Bun de sua versão de compatibilidade Node e consulta o Node real separadamente.
- Checks Rust passaram (fmt/clippy/três testes). Persistência após reinício do banco descartável passou pelo runner Bun.
- Docker multi-stage com `oven/bun:1.4.3` em instalação/build passou. Runtime final permanece `node:24.22.1-bookworm-slim`, sem Bun, usuário não privilegiado, dependências de produção filtradas.
- `bun run stack:up` e smoke autenticado do LiveKit passaram, com migrations novas e API Node pronta. O CLI Tauri 2.12.4 executou sob Bun no macOS; build/execução Windows continuam pendentes.

Bun não foi colocado no código browser/domínio, e Vitest continua como runner: `bun run test`, não `bun test`. Typecheck, ferramentas de segurança e metas de cobertura foram preservados. CI foi atualizado para instalar Bun fixado e manter Node para API/E2E; execução remota continua não confirmada. Não houve push/deploy nem alteração de escopo de mídia.


## Atualização: Bun Test nativo

Bun Test substituiu Vitest e seu provedor de cobertura, conforme ADR 0008. Mocks, timers e montagem React foram adaptados às APIs nativas; backend e DOM usam processos separados e isolamento por arquivo. Playwright permanece para E2E.

Resultados locais desta atualização:

- `bun install --frozen-lockfile` e `bun run check:ts` passaram em cópia limpa sem node_modules, configuração local ou builds prévios: tipos, Biome, arquitetura, 35 testes unitários/DOM e builds. A mesma verificação passou no workspace principal.
- `bun run test:coverage` passou com **36 testes**, incluindo PostgreSQL real descartável: **99,14% de linhas** e **96,70% de funções**, com **80% por arquivo** e inventário de **23 fontes executáveis de produto**. Os contadores nativos não são diretamente comparáveis aos percentuais históricos V8/Vitest. A execução Docker exige acesso ao daemon; foi concluída com esse acesso.
- Regressões LCOV rejeitam arquivo abaixo da meta apesar de média alta, contadores inválidos e percentual inferior a 80% que arredondaria para 80%. Uma fixture temporária com teste aprovado e somente 50% das funções cobertas confirmou saída 1 do Bun Test com meta de 100%, sem alterar a política permanente.
- Os **6 E2E** passaram após remover Vitest, com API compilada sob Node 24.22.1 e PostgreSQL descartável.
- Build multi-stage Docker passou com o novo lockfile. Bun instala/constrói; Node 24.22.1 continua no runtime final da API.
- Não há imports, configs ou dependências Vitest restantes nos manifests/lockfile/código ativo. Relatórios HTML de sumário com linhas não cobertas, JSON e LCOV são produzidos pelo fluxo nativo.

Benchmark alternado, três execuções locais sem cobertura/DB/E2E: Vitest no Bun (32 testes) teve mediana **0,696s**; Bun Test (35 testes e build de contratos) **0,727s**. Os custos diferem e o resultado ficou praticamente empatado; não há alegação de ganho adicional de velocidade. A adoção simplifica as ferramentas. Dados brutos em `docs/benchmarks/bun-native-2026-10-26.json`.

Esta seção substitui a decisão histórica acima de manter Vitest. CI remoto, shell Windows e implementação/provas de mídia continuam pendentes.

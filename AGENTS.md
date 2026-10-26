# Instruções do projeto

## Preferências pessoais de ferramentas

- Para consultas SQL, inspeção de dados ou alterações operacionais nos bancos Neon, use primeiro o MCP do Neon. Não use Metabase como acesso alternativo ao banco.
- Use a skill do Metabase somente quando o pedido for criar ou editar gráficos e perguntas no Metabase. Leituras de metadados e prévias SQL nessa skill servem apenas a esse trabalho.
- Para comparar uma configuração entre produção e stage, identifique projeto, branches e banco pelo MCP do Neon e faça consultas pequenas dos campos relevantes. Não comece por infraestrutura, secrets, logs ou navegador quando a informação está no banco.
- Separe a consulta do estado atual da alteração: comunique o resultado assim que confirmado e depois faça apenas as validações necessárias para a mudança autorizada. Preserve validações da aplicação e auditoria; não use SQL para contorná-las.
- Não fixe em memória qual gateway está ativo: consulte o estado atual de cada ambiente. Investigue infraestrutura ou acesso somente se houver um bloqueio concreto.

## Escopo e arquitetura

- PLAN.md é a fonte única dos marcos. Este setup cobre somente M0; não marcar mídia pronta por ter shells ou SFU saudável.
- Um workspace Bun e um Cargo workspace na raiz. Use `workspace:` para dependências TS locais; `default-members` Rust preserva checks sem desktop.
- API: monólito modular hexagonal. Domínio puro; aplicação depende de portas; Hono/Drizzle/LiveKit somente nas bordas. `src/index.ts` compõe adapters.
- Rust: domínio sem Tauri/Win32/RTC/serde; aplicação depende do domínio. Shell compõe adapters. Dependências nativas futuras devem ser condicionais por plataforma.
- DTOs HTTP/IPC em `packages/contracts`; entidades ORM não são DTOs. Atualize fixture e testes de compatibilidade IPC nos dois lados.
- Não trafegue frames/PCM via JSON, estado React ou API de controle.

## Segurança e evidência

- Segredos somente backend/configuração local ignorada; nunca `VITE_*`, IPC de diagnóstico, log ou imagem. Não imprimir Compose resolvido.
- Sem endpoints de login/token permissivos ou identidade de cliente usada como autorização. Fronteiras não implementadas falham explicitamente.
- Sem troca silenciosa de fonte nem captura automática. Captura/RTC retornam `NotImplemented` ou `UnsupportedPlatform`; não usar `todo!()` em caminhos acessíveis.
- Não mostrar FPS medido, suporte a encoder, E2EE ativa ou capacidade de rede sem implementação e prova real. Catálogo não representa hardware detectado.
- Preserve validações/auditoria da aplicação. Migrations explícitas versionadas, sem db push ou schema alterado por HTTP.
- Fluxos normais preservam volumes. Testes descartáveis só removem seus próprios recursos identificados.

## Validação

- `bun run check` agrega `check:ts`, `check:rust` e `test:coverage`; cobertura exige Docker para banco descartável e não mascara ferramentas ausentes.
- `bun run test:integration` e `bun run test:persistence` usam PostgreSQL descartável, sem tocar na base de desenvolvimento.
- `bun run smoke` verifica controle e migrations, não prova mídia. Não reinicia a base.
- Windows: `bun run build:desktop`; CI testa também o contrato IPC Rust. Não alegar build Windows se executou somente macOS/Linux.
- Não rodar `cargo test --workspace --all-targets` indiscriminadamente em Linux. Cargo default-members são os crates portáveis.
- Documente verificações executadas e bloqueios em `docs/validation.md`. Não confundir workflow escrito com execução de CI.

## Convenções de organização e legibilidade

- Leia `docs/frontend.md` e `docs/testing.md` antes de alterar estrutura, UI, ferramentas ou testes. Regras adaptadas de `~/www/truco`, sem copiar regras de produto daquele jogo.
- Frontend segue `src/app`, `src/features/<feature>` e `src/shared` quando houver reutilização concreta. `app` contém montagem/composição e o manifesto global de CSS. Não crie pastas vazias antecipadas.
- Cada feature expõe API pública pequena em `index.ts`. Features não importam os internos de outras; `shared` não depende de features/app; features não dependem da composição app. Workspaces usam exports públicos e `workspace:`.
- Páginas ficam em `pages/Nome/index.tsx`; componentes em `components/Nome/index.tsx`, com filhos exclusivos dentro do pai. Testes e estilos ficam junto da responsabilidade. `pages` contém somente páginas e testes; estilos de página vão em `styles` da feature.
- Hooks, serviços e utilitários são nomeados por responsabilidade e ficam na feature enquanto exclusivos. Evite `utils.ts`, `helpers.ts`, divisões mecânicas e cadeias de barrels. Promova código a shared apenas com reutilização real. Tokens comuns web/desktop ficam em `packages/ui`.
- Código em inglês; UI, documentação e respostas em pt-BR. Tipos específicos, entradas externas como `unknown`, validação de runtime; sem `any`, casts duplos ou non-null assertions para esconder falhas.
- Use TypeScript nos scripts autorais: `scripts/*.ts` executados por Bun 1.4.3, com typecheck separado. A API publicada permanece em Node LTS; não levar APIs Bun para o domínio/browser ou para runtime de produção sem nova decisão. Não adicionar JS/MJS/CJS autoral sem necessidade concreta. Bundles gerados e extensões publicadas por dependências não são código autoral.
- Biome: 2 espaços, largura 100, aspas simples JS/TS, trailing commas. Preserve uma linha em branco entre blocos lógicos (preparação, validação, efeitos, retorno), entre funções/métodos e responsabilidades distintas. Mantenha instruções relacionadas juntas; não compacte funções nem insira linhas vazias mecanicamente após cada instrução.
- Acima de 300 linhas: revisar coesão; chegando a 450: extrair responsabilidades; com 500 ou mais: refatorar antes da entrega. Pastas com cerca de 15 arquivos diretos merecem revisão. Lockfiles/gerados ficam fora desses limites.
- Não replique estado autoritativo em React. Separe estado confirmado, estado local de interação e estado visual. Falhas de captura/transporte não autorizam mudar a origem ou inventar métricas.

## Política de testes e cobertura

- Todo comportamento implementado/alterado tem regressões pertinentes: sucesso, rejeições, limites, cleanup e corridas quando aplicáveis. Use relógios falsos e testes determinísticos; imports sem asserções não contam como evidência.
- Unitários/DOM: Bun Test nativo (`bun:test`), React Testing Library e Happy DOM; integração: HTTP/aplicação/PostgreSQL real descartável; E2E: Playwright em Chromium desktop/mobile. Não adicionar runner equivalente em paralelo.
- Mínimo obrigatório: 80% de linhas e 80% de funções **por arquivo executável medido**, com inventário de fontes. Não reduzir metas, esconder fontes, mover comportamento para exclusões ou ignorar falhas para aprovar.
- `bun run test:coverage` limpa relatórios antigos, combina unitários/DOM/banco, aplica as metas e verifica fontes ausentes. Playwright roda à parte; sua cobertura não é somada aos percentuais do Bun Test. A política LCOV verifica cada arquivo antes do inventário; não aceitar médias que escondam arquivo abaixo de 80%. Rust tem checks/testes próprios, sem promessa de cobertura numérica ainda.
- Antes de entregar: executar checks afetados, `bun run test:coverage`; rodar E2E ao alterar comportamento UI, runtime/build/navegador. Relatar comandos, resultados e limitações reais. CI configurada não significa CI executada.
- Ao mudar layout, capturar e inspecionar visualmente desktop e celular com as ferramentas de navegador disponíveis; verificações geométricas e E2E complementam a inspeção. Preservar identidade visual e acessibilidade.

- Bun é o gerenciador e runtime das ferramentas; use `bun install --frozen-lockfile` e `bun run <script>`. Preserve `bun.lock`, não reintroduza lockfile pnpm. Bun Test nativo é o runner. Use `bun run test` para executar os ambientes backend/DOM isolados; `bun test <arquivo>` exige o preload apropriado no DOM. Não reduzir o gate de cobertura. Ver ADRs 0007 e 0008.

# Screen Share

Fundação de um aplicativo privado de compartilhamento de tela entre amigos. Este repositório implementa **somente M0** de [PLAN.md](PLAN.md): API de controle, viewer web, shell Tauri, contratos, persistência e ambiente local.

**Captura, transmissão, áudio, login, convites, player RTC e E2EE ainda não estão implementados.** O botão de transmissão permanece desabilitado. Não há endpoint de emissão de tokens ou acesso a salas. O catálogo não mede a capacidade do computador.

## Pré-requisitos e versões

| Ferramenta                       | Versão fixada                                               |
| -------------------------------- | ----------------------------------------------------------- |
| Node.js LTS                      | 24.22.1 (`.node-version`; checks também aceitam 24 >=24.11) |
| Bun                              | 1.4.3 (`.bun-version`, `packageManager`)                    |
| Rust                             | 1.99.1, rustfmt e clippy (`rust-toolchain.toml`)            |
| TypeScript / Hono / adapter Node | 7.0.2 / 4.13.14 / 2.1.5                                     |
| Tailwind CSS / plugin Vite       | 4.3.3 / 4.3.3                                               |
| React / Vite                     | 19.3.1 / 8.3.5                                              |
| Tauri Rust / CLI JS / build      | 2.12.5 / 2.12.4 / 2.7.4                                     |
| Drizzle ORM / Kit / pg           | 0.45.4 / 0.31.11 / 8.23.1                                   |
| Biome / Bun Test                 | 2.6.3 / 1.4.3 (nativo ao Bun)                               |
| PostgreSQL / LiveKit             | 17.11-bookworm / v1.13.11                                   |
| LiveKit server SDK               | 2.19.2                                                      |

Docker com Compose v2 é necessário para banco/SFU e os testes descartáveis. Desktop: Windows 11 x64, Visual Studio Build Tools com **Desktop development with C++**, Windows SDK e WebView2 Runtime. Rust usa o target MSVC. macOS/Linux podem trabalhar na API, interfaces web e crates portáveis. Os scripts não instalam SDKs ou ferramentas globais; Cargo pode baixar a toolchain declarada quando iniciado.

As versões foram consultadas em registries oficiais em 26/10/2026 e os lockfiles gerados pelos gerenciadores. Veja [fontes e decisões](docs/adr/0001-monorepo.md) e [evidências de validação](docs/validation.md).

## Primeiro uso (API no host)

Instale/ative Bun 1.4.3, Node 24.22.1 e as demais ferramentas acima. No diretório do clone:

```sh
bun install --frozen-lockfile
bun run bootstrap
bun run doctor
bun run infra:up
bun run db:migrate
bun run dev
```

Abra [viewer](http://localhost:5173), [liveness](http://127.0.0.1:3000/healthz), [readiness](http://127.0.0.1:3000/readyz) e [catálogo](http://127.0.0.1:3000/v1/video-profiles). Em outro terminal, `bun run smoke` verifica esses contratos e faz uma leitura administrativa autenticada do LiveKit. Não imprime credenciais nem conteúdo de salas e não comprova mídia.

O bootstrap cria `.env` e `infra/livekit/local.yaml` **apenas se ausentes**, com segredos criptograficamente aleatórios. Reexecutá-lo preserva ambos. Revise `.env.example` para os nomes. Se alterar credenciais do LiveKit no `.env`, remova somente `infra/livekit/local.yaml` e execute bootstrap novamente. Se alterar senha do PostgreSQL em volume existente, coordene a mudança com o banco: variáveis da imagem não alteram uma senha já inicializada. Não apague volumes para corrigir configuração.

Para abrir o desktop em Windows, em outro terminal:

```sh
bun run dev:desktop
```

Esse comando inicia o Vite exclusivo do desktop em `127.0.0.1:1420`. Não inicia outro viewer nem outra API. A UI desktop usa somente o IPC `get_app_info` no M0. A prévia web do desktop não fornece um motor nativo.

## API em container (perfil app)

Encerre `bun run dev` antes de mudar de modo, pois as duas APIs usam a porta 3000:

```sh
bun run stack:up
bun run --filter @screen-share/viewer-web dev
bun run smoke
```

`stack:up` inicia infraestrutura, para a API anterior, constrói a imagem, executa um migrador **novo e descartável**, e só inicia a API após sucesso. A cada execução reaplica/verifica o histórico atual; não depende de um container antigo de migration. Não substitua esse fluxo por `docker compose up` quando houver mudanças de schema. Se falhar uma migration, a API permanece parada.

A imagem usa build multi-stage e runtime `node` sem privilégios. Banco interno: `postgres:5432`; controle LiveKit interno: `http://livekit:7880`. No host, usam-se `127.0.0.1`. O browser só recebe a URL pública local da API, definida por `VITE_API_URL` ou pelo padrão. Não coloque credenciais em `VITE_*`.

`bun run stack:down` remove containers/rede e preserva o volume. `bun run infra:down` para apenas PostgreSQL e LiveKit. Nenhum comando normal apaga dados.

## Comandos

| Comando                           | Comportamento                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `bun run bootstrap`               | Cria arquivos locais ausentes sem imprimir segredos                                                       |
| `bun run doctor`                  | Verifica ferramentas, configuração, Compose e ocupação TCP; falha em requisitos ausentes                  |
| `bun run infra:up` / `infra:down` | Inicia/para banco e SFU; preserva volume                                                                  |
| `bun run db:migrate`              | Executa migrations SQL com Drizzle e retries limitados                                                    |
| `bun run dev`                     | API e viewer no host, com encerramento coordenado                                                         |
| `bun run dev:desktop`             | Tauri e seu próprio Vite, somente no Windows                                                              |
| `bun run stack:up` / `stack:down` | Modo API em container / encerra stack sem apagar volume                                                   |
| `bun run check:ts`                | Biome, tipos, testes de contrato/HTTP e builds TS das três aplicações                                     |
| `bun run check:rust`              | Fmt de todo o código; clippy/test dos quatro crates portáveis, com lockfile                               |
| `bun run check`                   | Agrega TS, Rust portável e cobertura com banco descartável; requer Docker                                 |
| `bun run smoke`                   | API, readiness/migrations, catálogo e listagem autenticada no controle LiveKit                            |
| `bun run test:integration`        | Cria PostgreSQL descartável, verifica migrations, constraints e readiness, remove o container ao terminar |
| `bun run test:persistence`        | Verifica dados e migrations após reiniciar PostgreSQL em volume descartável                               |
| `bun run build:desktop`           | Build Tauri/NSIS no Windows; artefato de desenvolvimento sem assinatura                                   |

Os testes descartáveis usam nomes únicos e nunca a `DATABASE_URL` do desenvolvimento. A limpeza remove somente os recursos criados pelo próprio teste. `check` não baixa nem instala SDKs de mídia.

## Estrutura

```text
apps/control-api       Hono, composição, módulos e migrations
apps/viewer-web        React/Vite e catálogo público local
apps/desktop           React/Vite e shell src-tauri
crates/domain          Regras e perfis sem frameworks
crates/application     Portas e caso de uso do cliente
crates/media-windows   Fronteira de captura indisponível
crates/rtc-livekit      Fronteira de RTC indisponível
packages/contracts     Schemas HTTP/IPC e fixture de compatibilidade
packages/ui            Tema e estilos compartilhados (Tailwind CSS)
infra                  Compose e template LiveKit
scripts                Utilitários Node multiplataforma
docs                   Arquitetura, desenvolvimento, segurança, evidências e ADRs
```

## Portas e limites de rede

Todas as publicações do Compose ficam em `127.0.0.1`: PostgreSQL 5432/TCP, API 3000/TCP, LiveKit 7880/TCP (sinalização/controle), 7881/TCP (ICE), 7882/UDP (mux). Os processos nos containers escutam nas interfaces internas necessárias. O LiveKit anuncia ICE `127.0.0.1`, sem descoberta STUN externa. O template usa campos da release fixada, não interpolação presumida do arquivo montado.

Essa configuração serve para controle e futuros experimentos no mesmo computador. Docker Desktop/WSL usam NAT/VM e loopback não alcança outro PC; M1 exigirá validar candidatos ICE, firewall e conectividade em dois PCs. Não há TURN, relay aberto, TLS público ou configuração LAN. Um HTTP saudável não comprova WebRTC.

## Diagnóstico

- `doctor` aponta Node diferente: ative `.node-version`; a execução local em 24.11 é parcial até repetir em 24.22.1.
- `readyz` retorna 503: confira `infra:up`, o banco configurado e `db:migrate`. A API omite detalhes de banco da resposta e do log. Migrations não são disparadas por HTTP.
- Porta 3000 ocupada: finalize a API do modo anterior; use `stack:down` ao retornar ao modo host.
- Porta 5173 ocupada: defina `VIEWER_PORT=5174` e ajuste `CORS_ORIGINS` para os endereços locais com essa porta no `.env`; reinicie API e viewer. O Vite carrega a configuração da raiz.
- Porta 5432 ocupada: pare o serviço conflitante ou ajuste explicitamente o mapeamento **e** `DATABASE_URL`. Não confunda esse endereço com `postgres` na rede Docker.
- Falha no Docker: inicie Docker Desktop/OrbStack e confira `docker info`. Os testes Docker não são mascarados como aprovados.
- LiveKit rejeita credenciais: confira se `.env` corresponde ao arquivo gerado; gere o arquivo local novamente somente após decidir a rotação.
- Desktop não compila: siga [setup Windows](docs/development.md); não execute testes de todo o workspace em Linux sem dependências desktop.

O próximo passo é **M1: WGC → D3D11 → encoder H.264 → LiveKit/WebRTC**, com evidências reais em dois PCs. O restante do produto segue exclusivamente os marcos de [PLAN.md](PLAN.md).

## Organização e testes

O frontend agora segue as convenções por feature do projeto Truco: `src/app` para montagem/composição, `features/<feature>` com API pública pequena e testes próximos, `shared` apenas quando houver reutilização concreta. Veja [organização e estilo](docs/frontend.md) e [política de testes](docs/testing.md).

Scripts autorais são `.ts`, executados por Bun e verificados por TypeScript. Bun gerencia workspaces/instalação por `bun.lock` e executa Bun Test, Vite e Playwright. A API publicada continua em Node LTS; `bun run test` coordena Bun Test nativo com backend e DOM isolados; os testes importam `bun:test`. Biome usa 2 espaços, largura 100, aspas simples e trailing commas. `bun run lint` inclui as regras de fronteiras de imports.

```sh
bun run test                  # unitários + componentes DOM; sem Docker
bun run test:integration      # PostgreSQL descartável
bun run test:coverage         # gate 80% linhas/funções por arquivo + inventário
bun run test:e2e:install      # Chromium gerenciado pelo Playwright
bun run test:e2e              # API/DB reais, previews isolados, desktop + mobile
```

`bun run check:ts` permanece disponível sem Docker. `bun run check` inclui também Rust e a cobertura completa, exigindo Docker. Relatórios ficam em `coverage/index.html`, `playwright-report` e `test-results`; são locais e ignorados no Git. O CI Linux executa cobertura/E2E e anexa esses relatórios.

## Bun e desempenho local

Adotamos Bun 1.4.3 após comparar a mesma suíte: mediana de 1,977s em Node 24.22.1 contra 0,916s em Bun, em três execuções alternadas. Resultado local, sem promessa universal de aceleração. Cobertura, E2E e typecheck foram preservados. A decisão e os dados estão na [ADR 0007](docs/adr/0007-bun-development.md). A API da imagem final permanece em Node; Bun é usado no desenvolvimento e nos estágios de build.

## Runner nativo de testes

Vitest foi substituído pelo Bun Test após a avaliação adicional solicitada. Os 32 cenários existentes foram preservados e três testes da política LCOV foram adicionados. O fluxo unitário/DOM tem 35 testes; com banco, são 36. A comparação local ficou praticamente empatada (mediana 0,696s Vitest/Bun versus 0,727s fluxo nativo com build de contratos e três testes extras), portanto não se anuncia ganho adicional de velocidade. A decisão é simplificar a stack de testes; ver [ADR 0008](docs/adr/0008-native-bun-test.md).

A cobertura nativa mantém o mínimo por arquivo e o inventário. Relatórios: `coverage/server/lcov.info`, `coverage/frontend/lcov.info`, `coverage/lcov.info`, `coverage/coverage-summary.json` e `coverage/index.html` (sumário por arquivo e linhas não cobertas). Os contadores nativos não são diretamente comparáveis aos percentuais anteriores do V8/Vitest.

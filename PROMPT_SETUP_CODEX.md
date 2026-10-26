# Prompt para o Codex: setup inicial do projeto

> Uso: coloque `PLAN.md` na raiz do repositório, abra o diretório no Codex e envie o texto abaixo. O plano descreve o produto inteiro; esta tarefa executa somente o marco **M0 - bootstrap**. Nome técnico provisório: `screen-share`; preserve o nome de um projeto existente.

---

Você é um Staff Software Engineer com experiência em Rust, Windows, Tauri, TypeScript, WebRTC, segurança e experiência de desenvolvimento. Trabalhe nos arquivos do repositório e entregue um setup inicial executável, documentado e verificável.

## 1. Objetivo e modo de trabalho

Crie a fundação de um aplicativo privado de compartilhamento de tela entre amigos. Leia `PLAN.md` e as instruções existentes do repositório antes de editar. Execute somente o marco M0: linguagens, workspaces, arquitetura, serviços locais, aplicações mínimas, migrations, checks, CI e documentação.

O produto futuro terá transmissor Windows 11, player privado web, salas de 2 a 8 pessoas, uma live ativa inicialmente, áudio do aplicativo e oito perfis: 480p, 720p, 1080p e 1440p/QHD, cada um em 30 ou 60 FPS. Terá métricas, recomendação de qualidade e E2EE. Esses recursos de mídia e acesso privado serão implementados nos próximos marcos.

Inspecione o estado atual e preserve trabalho existente. Inicialize Git somente se o diretório ainda não for um repositório. Faça as alterações localmente; criação de remote, push e deploy não fazem parte deste pedido. Resolva escolhas rotineiras com bom julgamento e registre decisões relevantes. Não pare em um plano ou em uma lista de comandos: implemente, execute as verificações possíveis e corrija problemas do setup.

## 2. Stack e versões

- Monorepo TypeScript com **pnpm workspaces**.
- API em **Node.js LTS + TypeScript estrito + Hono**, usando o adapter oficial para Node.
- Interfaces em **React + TypeScript + Vite**.
- Desktop em **Tauri 2 + Rust**, com Cargo workspace na raiz.
- Persistência em **PostgreSQL + Drizzle**, migrations SQL versionadas.
- Infraestrutura de mídia em **LiveKit self-hosted**.
- Formatação/lint TypeScript com **Biome**; testes TypeScript com **Vitest**.
- Rust com **rustfmt, clippy e cargo test**.
- Docker Compose e GitHub Actions.

Consulte documentação e versões estáveis compatíveis no momento da implementação. Fixe versões reais: `.node-version`, `packageManager` com pnpm exato, `rust-toolchain.toml` com release estável concreta, dependências e imagens OCI. Gere e versione `pnpm-lock.yaml` e `Cargo.lock`; não fabrique lockfiles. Não use `latest` como versão de imagem ou dependência permanente. Registre as versões verificadas e requisitos de sistema.

Mantenha o número de ferramentas pequeno. Este setup não precisa de Kubernetes, microserviços de negócio, broker de eventos, Redis, monorepo framework adicional ou um novo runtime no backend.

## 3. Estrutura e dependências

Use esta organização; crie arquivos com responsabilidade real, evitando diretórios vazios e abstrações sem uso:

| Caminho                  | Responsabilidade                                                   |
| ------------------------ | ------------------------------------------------------------------ |
| `apps/control-api`       | API de controle em Hono; módulos com domínio, aplicação e adapters |
| `apps/viewer-web`        | Interface web e futuro player privado                              |
| `apps/desktop`           | UI React/Vite do desktop                                           |
| `apps/desktop/src-tauri` | Shell Tauri e composição das dependências Rust                     |
| `crates/domain`          | Tipos, validações e regras puras do cliente                        |
| `crates/application`     | Casos de uso, portas e estado do cliente                           |
| `crates/media-windows`   | Fronteira de captura/encode Windows, ainda indisponível            |
| `crates/rtc-livekit`     | Fronteira do transporte nativo, ainda indisponível                 |
| `packages/contracts`     | DTOs e validação dos contratos HTTP compartilhados                 |
| `infra/compose.yaml`     | PostgreSQL, LiveKit e perfil opcional da API                       |
| `infra/livekit`          | Template versionado e configuração local gerada                    |
| `scripts`                | Utilitários Node multiplataforma                                   |
| `docs/adr`               | Decisões arquiteturais curtas                                      |
| `.github/workflows`      | CI                                                                 |

Crie um único `Cargo.toml` de workspace na raiz, incluindo `apps/desktop/src-tauri` e os crates. Use `default-members` para os crates portáveis. Não crie workspaces Cargo aninhados. Configure `pnpm-workspace.yaml`, nomes únicos, pacotes privados e dependências locais com protocolo `workspace:`. Alinhe TypeScript, exports e formato de módulos com os builds executados de fato.

Adote arquitetura hexagonal e monólito modular na API. Dependências apontam para dentro: domínio não importa Hono, Tauri, LiveKit, Win32 ou Drizzle. O composition root conecta adapters e aplicação. Entidades do ORM não saem do adapter de persistência.

Separe contratos de transporte de entidades de domínio. DTOs IPC Rust devem ser pequenos, serializados na fronteira e ter correspondência TypeScript verificável. Documente a fonte de verdade dos contratos; não imponha um grande pipeline de geração antes de ele ser necessário.

## 4. Aplicações mínimas que devem funcionar

### API

- Configuração validada na inicialização, erros saneados, request ID, logging estruturado e graceful shutdown.
- Pool PostgreSQL limitado, consultas de diagnóstico com timeout e fechamento correto das conexões.
- `GET /healthz`: prova que o processo está vivo.
- `GET /readyz`: consulta autenticada ao banco e verificação de que as migrations necessárias foram aplicadas. Falha retorna 503 sem detalhes sensíveis.
- `GET /v1/video-profiles`: catálogo estático das oito combinações, com dimensões e FPS. Catálogo não representa capacidade detectada do PC.
- Migração inicial pequena de controle, por exemplo `rooms` com ID opaco, proprietário obrigatório, estado e timestamps. Não pré-modele toda a autenticação e todo o produto.
- Migrations explícitas e versionadas, sem `db push` como mecanismo padrão nem alterações de schema disparadas por requisições HTTP.

Login, entrada em salas, convites e emissão de tokens RTC ainda não têm implementação neste marco. Não abra endpoints que emitam JWT para qualquer sala ou aceite uma identidade enviada pelo cliente como autorização. Portas sem implementação falham explicitamente; não concedem acesso por padrão.

### Viewer web

- Tela inicial simples com identidade visual discreta, status de conectividade da API e catálogo de perfis.
- Estados de loading, indisponibilidade e erro reais.
- Área do futuro player claramente indicada como não implementada.
- Nenhuma câmera, microfone, captura ou conexão a sala iniciada automaticamente.

### Desktop

- Shell Tauri abre no Windows e usa React/Vite.
- Comando IPC pequeno, como `get_app_info`, retorna versão, plataforma e estado real de implementação.
- A UI mostra que captura/transmissão ainda não estão implementadas e mantém o botão de transmissão desabilitado.
- Tipos de perfil e estados básicos no domínio; um caso de uso simples demonstra a composição sem fingir uma sessão de mídia.
- Adapters retornam erros tipados como `NotImplemented` e `UnsupportedPlatform`; não use panics de `todo!()` em caminhos acessíveis.
- Crates puros compilam sem Tauri, GTK, Win32 ou libwebrtc. Dependências Windows ficam condicionais.

Não instale todo o SDK nativo LiveKit/libwebrtc apenas para preencher o adapter. A integração real com captura/encoder será a prova técnica seguinte. Não apresentar FPS fictícios, selo de E2EE ativo ou “encoder por hardware disponível” sem implementação e verificação.

## 5. Docker Compose e ambiente local

Entregue dois modos coerentes:

1. **Desenvolvimento padrão:** PostgreSQL e LiveKit no Compose; API, viewer e desktop no host.
2. **Perfil `app`:** API em container e migration one-shot, junto da mesma infraestrutura; interfaces continuam no host. Documente como evitar duas APIs concorrendo pela mesma porta.

Requisitos:

- Imagens versionadas, volume nomeado do PostgreSQL e configuração LiveKit montada como somente leitura. O caminho de persistência/`PGDATA` deve corresponder à versão principal da imagem PostgreSQL escolhida.
- API com Dockerfile multi-stage, contexto correto do monorepo, instalação reproduzível e usuário sem privilégios no runtime.
- `.dockerignore` exclui segredos, arquivos locais, caches e artefatos de build.
- Portas publicadas explicitamente em loopback. Sugestão: PostgreSQL `127.0.0.1:5432`, API `127.0.0.1:3000`, LiveKit sinalização `127.0.0.1:7880`, ICE/TCP `127.0.0.1:7881` e mux UDP `127.0.0.1:7882/udp`, conforme a configuração efetivamente suportada pela versão escolhida.
- Serviços escutam nas interfaces necessárias dentro do container; restrição ao host é feita no mapeamento das portas. Não confundir esses dois endereços.
- URLs distintas para serviços internos (`postgres`, `livekit`) e clientes/API no host (`localhost`). O browser não deve receber hostname interno Docker.
- Gere configuração LiveKit local válida a partir de template. Não suponha que variáveis `${...}` no YAML montado serão expandidas pelo servidor.
- Configure e documente endereços ICE conforme o schema real da versão escolhida. HTTP saudável não comprova transporte de mídia funcional.
- PostgreSQL usa healthcheck disponível na imagem. API depende de banco saudável e, no perfil `app`, migration concluída com sucesso. `stack:up` deve aplicar as migrations atuais mesmo após uma execução anterior bem-sucedida; não confiar em um container de migration antigo já concluído. A aplicação também precisa de retries limitados; `depends_on` não substitui recuperação em runtime.
- Não use `network_mode: host` como padrão multiplataforma. Documente limites de Docker Desktop/WSL para futuros testes RTC entre PCs.

TURN, domínio, TLS público, acesso LAN e implantação em nuvem ficam documentados para o marco de rede. Não entregue um relay aberto ou anuncie essa parte como funcional. O desktop e a captura Windows são executados nativamente, fora do Compose.

## 6. Configuração, scripts e segurança

Implemente utilitários Node compatíveis com Windows, macOS e Linux, sem depender de Bash para o fluxo principal. Não instalar SDKs, drivers ou ferramentas globais silenciosamente.

`pnpm bootstrap` deve criar `.env` e configuração LiveKit local apenas quando ausentes, gerar segredos aleatórios fortes, preservar valores existentes e nunca imprimir segredos. A execução deve ser idempotente. `.env.example` contém nomes, explicações e placeholders; segredos e configuração efetiva ficam ignorados pelo Git.

Segredos do banco e do LiveKit permanecem no backend/configuração local. Nenhum segredo administrativo pode aparecer em `VITE_*`, bundle frontend, IPC de diagnóstico, URL, log ou imagem Docker. CORS e CSP usam allowlists adequadas ao desenvolvimento; permissões Tauri são mínimas.

Crie e documente estes comandos reais na raiz:

| Comando              | Contrato                                                                          |
| -------------------- | --------------------------------------------------------------------------------- |
| `pnpm bootstrap`     | Prepara arquivos locais sem sobrescrever configuração existente                   |
| `pnpm doctor`        | Diagnostica versões, dependências, configuração e portas com mensagens acionáveis |
| `pnpm infra:up`      | Inicia PostgreSQL e LiveKit                                                       |
| `pnpm infra:down`    | Para a infraestrutura sem apagar volumes                                          |
| `pnpm db:migrate`    | Aplica migrations versionadas                                                     |
| `pnpm dev`           | Inicia API e viewer no host                                                       |
| `pnpm dev:desktop`   | Inicia somente o desktop e seu Vite, sem duplicar o servidor web                  |
| `pnpm stack:up`      | Inicia infraestrutura, migration e API no perfil `app`                            |
| `pnpm stack:down`    | Para a stack sem apagar dados                                                     |
| `pnpm check:ts`      | Lint, tipos, testes relevantes e builds TypeScript                                |
| `pnpm check:rust`    | Fmt, clippy e testes dos crates portáveis                                         |
| `pnpm check`         | Agrega checks portáveis com comportamento documentado                             |
| `pnpm smoke`         | Valida API, catálogo, migrations e conectividade de controle com LiveKit          |
| `pnpm build:desktop` | Build Tauri no ambiente Windows com os pré-requisitos instalados                  |

Não use `docker compose down -v` no fluxo normal. Um reset destrutivo, se realmente necessário, deve ser um comando separado e explícito. Não registre a saída de `docker compose config` com valores sensíveis; prefira validação sem imprimir a configuração resolvida.

No smoke, verifique LiveKit por uma chamada autenticada e somente de leitura pelo SDK de servidor, com timeout, sem imprimir credenciais ou conteúdo de salas. Isso não exige endpoint público de emissão de tokens e não comprova mídia RTC.

## 7. Verificação e CI

Crie testes pequenos que verifiquem comportamento existente: catálogo/validação de perfis, erros de aplicação, readiness com banco indisponível ou migrations pendentes e contrato HTTP. Inclua uma verificação real de migrations contra PostgreSQL e valide persistência após reinício em ambiente descartável. O smoke normal não deve reiniciar a base de desenvolvimento. Não criar testes repetitivos apenas para getters, pastas vazias ou placeholders.

Configure CI com jobs separados:

- Linux: instalação pnpm reproduzível, lint, typecheck, testes, build de API/viewer e integração PostgreSQL.
- Rust portável: fmt, clippy e testes dos crates puros.
- Windows: check/build do shell Tauri e das fronteiras Windows, com pré-requisitos documentados.
- Validação do Compose e do build da imagem da API.

Não execute `cargo test --workspace --all-targets` indiscriminadamente no Linux se isso exigir desktop e bibliotecas do sistema não instaladas. Não desative checks ou esconda erros para obter CI verde.

Execute localmente o que o ambiente permitir. Se faltar Docker, Windows, toolchain ou acesso a registry, conclua o trabalho independente e informe exatamente o que não foi validado. Não afirmar que compilou no Windows, transmitiu mídia ou testou E2EE quando isso não aconteceu. Build de desenvolvimento não deve ser anunciado como instalador assinado para distribuição.

## 8. Documentação e conclusão

Entregue:

- `README.md` em PT-BR com pré-requisitos, versões, sequência do primeiro uso, comandos, URLs, modos host/container e troubleshooting.
- `AGENTS.md` com limites de arquitetura, segurança, comandos de validação e regra de evidência para recursos de mídia. Respeite instruções existentes ao criá-lo/atualizá-lo.
- `PLAN.md` preservado na raiz como fonte única do plano, marcando somente itens efetivamente concluídos do M0.
- `docs/architecture.md` com módulos, dependências e diagrama compacto.
- `docs/development.md` com setup Windows e desenvolvimento parcial em outros sistemas.
- `docs/security.md` com segurança do bootstrap, limites atuais e requisitos futuros de autorização/E2EE.
- ADRs curtas para monorepo, arquitetura hexagonal, separação controle/mídia, contratos e ambiente local.
- `.editorconfig`, `.gitignore`, `.gitattributes`, configurações de TypeScript/Biome/Rust e lockfiles reais.

O critério de conclusão é uma pessoa conseguir clonar, instalar dependências, executar bootstrap, iniciar infraestrutura, migrar o banco, abrir API/viewer e iniciar o shell desktop no Windows seguindo o README.

No relatório final, apresente: o que foi criado, estrutura resultante, versões escolhidas, comandos de primeiro uso, verificações executadas com resultado, verificações bloqueadas com motivo e próximo passo concreto: prova nativa WGC/D3D11/encoder/WebRTC. A entrega atual é a base funcional do projeto; o desenvolvimento do restante segue os marcos do `PLAN.md`.

---

## Referências para o executor conferir

- [Tauri: pré-requisitos](https://v2.tauri.app/start/prerequisites/)
- [Tauri: Vite](https://v2.tauri.app/start/frontend/vite/)
- [Hono: Node.js](https://hono.dev/docs/getting-started/nodejs)
- [pnpm: workspaces](https://pnpm.io/workspaces)
- [Cargo: workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html)
- [Docker Compose: ordem de inicialização](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker: publicação de portas](https://docs.docker.com/engine/network/port-publishing/)
- [LiveKit: execução local](https://docs.livekit.io/transport/self-hosting/local/)
- [LiveKit: portas e firewall](https://docs.livekit.io/transport/self-hosting/ports-firewall/)

Referências consultadas em 26/10/2026. Verificar novamente versões e APIs na implementação; este arquivo não fixa números de release não validados.

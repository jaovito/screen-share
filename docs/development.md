# Desenvolvimento

## Windows 11 x64

1. Instale Git, Node 24.22.1 e Bun 1.4.3. Não é necessário Corepack.
2. Instale Rust via rustup e Visual Studio Build Tools (Desktop development with C++, MSVC, Windows SDK). Use o target `x86_64-pc-windows-msvc`, sem MinGW para o shell.
3. Confirme Microsoft Edge WebView2 Runtime. Consulte [pré-requisitos oficiais Tauri](https://v2.tauri.app/start/prerequisites/).
4. Inicie Docker Desktop com backend WSL2 para o Compose Linux. O desktop Windows roda nativamente, fora do WSL e do container.
5. Execute a sequência do README em PowerShell ou terminal nativo. Os comandos principais não dependem de Bash.
6. Execute `bun run dev:desktop`. O Tauri usa seu próprio `beforeDevCommand`, porta 1420 e `frontendDist` relativo a `src-tauri`; não precisa iniciar Vite manualmente.
7. Execute `bun run build:desktop` para NSIS. O executável/instalador de desenvolvimento não é assinado; assinatura/updates pertencem a M5.

O job Windows verifica crates/adapters, compila/testa o DTO IPC do shell e constrói o bundle de desenvolvimento. CI configurada não é evidência de execução até o workflow realmente rodar.

## macOS e Linux

`bun run dev`, `bun run check:ts`, `bun run check:rust`, integração SQL e Compose são o fluxo parcial suportado. `bun run --filter @screen-share/desktop dev` abre apenas uma prévia da UI: mostra a ausência de IPC, não inicia motor. `dev:desktop`/`build:desktop` falham explicitamente fora do Windows neste marco. Compilação manual do shell em outros sistemas não significa suporte a captura.

## Migrations

Depois de alterar `src/modules/rooms/adapters/schema.ts`:

```sh
bun run --filter @screen-share/control-api db:generate
bun run db:migrate
bun run test:integration
bun run test:persistence
```

Revise o SQL, journal e snapshot antes de versionar; nunca edite uma migration já aplicada. Não há `db push`, resets implícitos ou migrations acionadas por HTTP. A integração cria seu banco vazio; o teste de persistência tem seu volume próprio e reinicia somente seu container.

## Desenvolvimento e validação

`bun run check:ts` constrói contratos antes dos consumidores, faz typecheck dos testes da API e builds separados. `bun run dev` constrói contratos uma vez; após editar contratos, reinicie o comando ou rode o build desse pacote. Os scripts Bun repassam códigos de falha. A configuração local é carregada de `.env`; variáveis já definidas pelo ambiente têm precedência. Vite recebe apenas variáveis prefixadas por `VITE_`.

`bun run check:rust` usa `default-members` portáveis; não exige GTK, Tauri, Win32 ou libwebrtc. O lockfile inclui o shell, mas compilar o domínio não compila o shell. Para checks manuais use `cargo clippy --locked --all-targets -- -D warnings` e `cargo test --locked` na raiz. Não acrescente `--workspace` indiscriminadamente em Linux.

O Compose valida sem imprimir segredos com `docker compose --env-file .env -f infra/compose.yaml --profile app config --quiet`. Não publique saída de configuração expandida. As rotinas de smoke não reiniciam bancos nem emitem grants de sala.

## Limites de RTC

O SFU escuta em `0.0.0.0` dentro do container; o host publica somente loopback. `rtc.node_ip` é o candidato anunciado ao cliente, não o endereço de bind. A configuração usa `use_external_ip: false`, mux UDP 7882 e ICE/TCP 7881, sem range UDP concorrente. A escolha impede presumir acesso remoto e precisa ser revista explicitamente para o laboratório M1. Docker Desktop/WSL e NAT podem impedir uma rota que parece correta na sinalização. TURN autenticado, domínio, TLS, LAN e firewall serão tratados com evidência de rede em etapa posterior.

## Estilização compartilhada

Viewer e desktop usam Tailwind CSS 4.3.3 com o plugin oficial `@tailwindcss/vite` nos dois Vites. A configuração é CSS-first: cada `src/app/styles/index.css` importa `tailwindcss` e `@screen-share/ui/styles.css`, com `@source` explícito para futuros componentes compartilhados. Não há PostCSS nem `tailwind.config.js` necessários para esse setup.

`packages/ui/src/theme.css` define as variáveis semânticas e as expõe por `@theme inline`: `bg-background`, `text-foreground`, `bg-card`, `border-border`, `bg-primary`, `text-primary-foreground` etc. Edite os tokens nesse arquivo para refletir o tema em ambas as interfaces. `packages/ui/src/styles.css` preserva o layout atual na camada `components`, permitindo que utilities ajustem propriedades nos consumidores. O Biome aceita diretivas Tailwind por `css.parser.tailwindDirectives`.

Exemplo de uso já presente no viewer: `className="panel mt-6"`. Prefira classes completas no JSX; não construa nomes de utilities com interpolação parcial, para que o detector encontre os estilos. O pacote UI exporta CSS diretamente, sem etapa própria de build.

A biblioteca shadcn/ui ainda não foi instalada nesta configuração do Tailwind; seus componentes podem ser adicionados ao pacote compartilhado quando necessários. Referência: [integração oficial com Vite](https://tailwindcss.com/docs/installation/using-vite).

Scripts operacionais autorais agora ficam em `scripts/*.ts`, com imports `.ts` e execução nativa no Bun 1.4.3. A execução TypeScript não faz typecheck: `bun run typecheck` inclui scripts, tooling, configs e E2E. `bun run check` passou a incluir cobertura com PostgreSQL descartável e exige Docker; E2E continua separado. Veja [frontend.md](frontend.md) e [testing.md](testing.md).

O runner unitário/DOM agora é Bun Test nativo, com preloads/isolamento definidos em `scripts/test-suites.ts`. Use `bun run test` para o fluxo completo; integração e cobertura continuam em banco descartável. Relatórios LCOV/HTML/JSON são produzidos sem Vitest. Ver ADR 0008.

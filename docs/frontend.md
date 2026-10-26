# Organização e convenções do frontend

As regras seguem a organização de `~/www/truco`, adaptadas ao viewer e ao shell desktop deste projeto. Não carregam regras do jogo, PixiJS, autenticação ou decisões de produto alheias.

```text
apps/{viewer-web,desktop}/src/
  app/
    main.tsx
    App/index.tsx
    styles/index.css
  features/
    stream-viewer/                 # viewer-web
      index.ts
      pages/ViewerPage/index.tsx
      pages/ViewerPage/index.test.tsx
      hooks/use-control-connection.ts
      services/control-api.ts
    stream-control/                # desktop
      index.ts
      pages/ControlPage/index.tsx
      pages/ControlPage/index.test.tsx
      hooks/use-app-info.ts
      services/app-info.ts
```

A árvore mostra as responsabilidades reais; cada app possui somente sua feature. Não criar `shared`, `components`, `utils` ou `styles` de feature sem uso concreto. Componentes futuros usam `components/Nome/index.tsx`, testes e estilos próximos, filhos exclusivos no pai. `pages` contém apenas páginas e seus testes. Responsabilidade exclusiva continua na feature; reutilização web/desktop com fronteira estável pode ir a `packages/ui`.

`app` compõe features por suas entradas públicas. Features podem usar shared e contratos públicos, mas não importar a composição app ou os internos de outra feature. Shared não conhece features/app. Workspaces se acessam por exports, sem caminhos relativos cruzando pacotes. `bun run check:architecture` verifica imports estáticos, exports, imports dinâmicos literais, ciclos de imports locais e limite de 500 linhas; Biome restringe globais de runtime em browser/domínio/aplicação. Isso não substitui revisão de imports dinâmicos calculados ou arquitetura Rust.

O HTTP da feature viewer fica em services e valida contratos compartilhados. O hook cuida de estado, timeout, retry e cancelamento. O desktop concentra o acesso Tauri na borda services; o hook protege cleanup e a página não inicia captura. A UI continua honesta sobre indisponibilidade de mídia.

O manifesto `app/styles/index.css` é a entrada única de CSS: Tailwind, tema/estilos `packages/ui`, detector de classes compartilhadas e futuros estilos da feature/componente em ordem explícita. Componentes não importam CSS solto, evitando cascata dependente da ordem JS. Tokens compartilhados continuam em `packages/ui/src/theme.css`.

## Estilo e tipos

Biome usa 2 espaços, largura 100, aspas simples e trailing commas. Linhas em branco separam preparação, validações, efeitos e retorno, e funções/responsabilidades distintas. Declarações diretamente relacionadas ficam juntas. Essa separação é revisão humana: o formatter preserva o espaçamento e não interpreta blocos semânticos.

Arquivos acima de 300 linhas disparam aviso; perto de 450 precisam de extração; 500 ou mais falham no checker de produção. Avaliar pastas com cerca de 15 arquivos, sem agrupamentos artificiais. Nomear por conceito, sem arquivos genéricos ou uma função por arquivo por obrigação.

TypeScript permanece estrito com `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` e `noFallthroughCasesInSwitch`. Frontend de produção inclui tipos browser/Vite, sem globais Node; configs/scripts/testes possuem ambiente separado. Não usar `any`, non-null assertions ou casts duplos para contornar contratos.

Scripts autorais foram migrados de `.mjs` para `.ts`. Bun 1.4.3 executa os scripts; `tsconfig.json` verifica tooling, configs e E2E sem emitir código. Rust mantém rustfmt e suas regras próprias. Bun Test nativo passou a executar os testes unitários/DOM após a avaliação de compatibilidade; imports de teste usam `bun:test`, com preloads DOM e isolamento por arquivo. Bun substituiu pnpm e executa as ferramentas. A API publicada continua em Node LTS; o domínio/browser não importa APIs Bun.

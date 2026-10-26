# Frontend organization and conventions

These rules adapt `~/www/truco` organization to this project's viewer and desktop shell, without importing game rules, PixiJS, authentication, or unrelated product decisions.

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

The tree represents real responsibilities; each app currently has one feature. Do not create shared/components/utils/feature styles without actual use. Future components use `components/Name/index.tsx`, with nearby tests/styles and exclusive children inside the parent. Pages contain only pages and their tests. Exclusive code stays in its feature; stable reuse across web/desktop may move to packages/ui.

App composes features through public entries. Features may use shared/public contracts but not app composition or another feature's internals. Shared knows neither features nor app. Workspaces access public exports, never cross-package relative internals. `bun run check:architecture` checks static imports, exports, literal dynamic imports, local import cycles, and the 500-line production limit. Biome restricts runtime globals in browser/domain/application. These checks do not replace review of computed dynamic imports or Rust architecture.

Viewer HTTP lives in feature services and validates shared contracts. Its hook owns state, timeout, retry, and cancellation. Desktop keeps Tauri access in edge services; the hook protects cleanup and the page never starts capture. UI must remain honest about unavailable media.

`app/styles/index.css` is the single CSS manifest: Tailwind, packages/ui theme/styles, shared class detection, and future feature/component styles in explicit order. Components do not import loose CSS, avoiding a cascade dependent on JS import order. Shared tokens remain in `packages/ui/src/theme.css`.

## Style and types

Biome uses 2 spaces, width 100, single quotes, and trailing commas. Blank lines separate preparation, validation, effects, return, functions, and responsibilities. Related declarations stay together. This separation needs human review: formatting preserves spacing without understanding semantic blocks.

Files above 300 lines trigger a warning; near 450 they need extraction; 500 or more fail the production checker. Review folders around 15 files without artificial grouping. Name by concept, avoiding generic files or one-function-per-file mandates.

TypeScript stays strict with noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, and noFallthroughCasesInSwitch. Production frontend has browser/Vite types without Node globals; configs/scripts/tests have separate environments. Do not bypass contracts with any, non-null assertions, or double casts.

All documentation, code identifiers, comments, and developer-facing test descriptions are English. UI copy is localized in pt-BR, es, and en. Translation values use their target language; keys, documentation, and comments stay English. Protocol values and public identifiers are not translated.

Authored scripts migrated from .mjs to .ts and run on Bun 1.4.3. Root tsconfig checks tooling/configs/E2E without emission. Rust retains rustfmt and its conventions. Native Bun Test runs unit/DOM tests with bun:test imports, DOM preload, and per-file isolation. Bun manages dependencies/tools; the published API remains Node LTS, and browser/domain code imports no Bun APIs.


## UI internationalization

Both apps use i18next 26.5.11/react-i18next 17.1.9 through the browser-safe `@screen-share/i18n` workspace. The package owns LocaleProvider, LanguageSelector, supported locales, common labels, and preference persistence. Each app creates an independent provider instance at composition time; there is no shared global i18next singleton. Dependencies are pinned in bun.lock.

Feature copy stays alongside its owner: `features/stream-viewer/locales/{en,es,pt-BR}.ts` and `features/stream-control/locales/{en,es,pt-BR}.ts`. Each locale index uses `satisfies Translations<typeof en>` to require the English schema's keys in every language. Feature hooks expose typed translation keys; app composes the exported dictionaries through LocaleProvider. The shared package never imports feature internals.

Default/fallback is **pt-BR**. The accessible header selector offers Português (Brasil), Español, and English. A canonical supported choice is stored as `screen-share.locale` in localStorage and restored on reload. Preferences are per origin: viewer and desktop previews on different ports do not share browser storage, nor do separate native/web origins. There is no browser-language auto-detection, account-wide sync, translation service, cookie, or external locale request. Unsupported preferences fall back to pt-BR; blocked storage does not prevent changing language during the current session.

Resources are bundled and initialize synchronously so startup does not flash translation keys. Language changes update document lang/title, headings, accessible labels, status/error/empty states, and interpolated profile labels without refetching API data or repeating IPC. Store state/error codes in hooks and translate at render time, rather than storing localized sentences in state. Interpolation uses React text rendering, never injected HTML.

To add UI copy, add an English key and matching Spanish/Portuguese entries in the owning feature, then call its typed useMessages hook. Use named interpolation for dynamic values instead of concatenating sentences. Keep stable brands, dimensions, FPS, protocol values, and native platform identifiers unchanged. Shared selector styles live in packages/ui and follow the single CSS manifest. For future dates/numbers, use Intl with the selected locale; rich text/plural forms should follow i18next APIs when a real use case requires them.

Validation covers default/persisted/invalid preferences, unavailable storage, live asynchronous state updates, translated native errors/status, and no extra HTTP/IPC on locale changes. E2E verifies all viewer locales and desktop English/Spanish with reload persistence, metadata, media remaining disabled, and desktop/mobile overflow assertions. Inspect generated screenshots for long translated text. The provider takes immutable bundled resources for the lifetime of an app mount.

Primary documentation: [I18nextProvider](https://react.i18next.com/latest/i18nextprovider), [i18next configuration](https://www.i18next.com/overview/configuration-options).

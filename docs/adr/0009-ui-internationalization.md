# Shared UI internationalization with feature-owned catalogs

Status: accepted at the user's request · 2026-10-26.

## Context

Viewer and desktop need pt-BR, Spanish, and English without coupling localized text to control state or adding network dependencies. Frontend ownership rules require exclusive copy to remain with its feature, while locale behavior is genuinely shared.

## Decision

Use pinned i18next/react-i18next through a browser-safe packages/i18n workspace. Each application composes its own LocaleProvider with feature-owned bundled catalogs and typed translation keys. Common labels, locale selector, persistence, and document metadata behavior are shared. Do not use a global singleton or change HTTP/IPC contracts for translated presentation.

pt-BR is default/fallback; supported canonical locales are pt-BR, es, en. Selection is explicit and persisted per origin in localStorage; unavailable storage degrades to session-only changes. Do not infer locale from browser language or synchronize accounts/origins in this setup. Bundled resources initialize synchronously and need no remote translation backend.

## Alternatives and consequences

A custom translation engine would duplicate established locale/fallback behavior. A single central product catalog would hide feature ownership. Per-app locale runtimes would duplicate selector/persistence logic. The shared package provides the common mechanism while features retain copy and English-key schemas.

Language changes rerender presentation without repeating HTTP/IPC or restarting asynchronous work. Documents/code/comments stay English; translation values use their target language. React text rendering handles escaping; no translated HTML injection is introduced. Resource objects are immutable for the lifetime of a provider mount. Bundle size increases because three small catalogs and libraries are included eagerly; loading strategies can change if actual catalog growth warrants them.

## Validation and limits

Unit/DOM checks cover persistence, unsupported preference, blocked storage, in-flight status updates, metadata, and unchanged request counts. Desktop/mobile E2E covers selection/reload and unavailable-media behavior. This validates browser UI/desktop preview, not native Windows execution, media, or E2EE. Evidence is recorded in docs/validation.md.

Sources: [React provider](https://react.i18next.com/latest/i18nextprovider), [i18next configuration](https://www.i18next.com/overview/configuration-options).

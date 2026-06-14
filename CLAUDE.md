# CLAUDE.md — Lexis Desktop App

This is the primary instruction file for Claude Code. Read this entire file before doing anything.

## Project Overview

**Lexis** is a cross-platform desktop application built with Electron that combines sentence mining, dictionary lookup, local flashcard creation, and Anki-style SRS review into a single workflow. Users read foreign language content (subtitles, ebooks, web articles), highlight sentences, look up words, create cards, and review them inside Lexis — all without switching apps.

## Tech Stack (Do Not Deviate)

| Layer | Technology | Version |
|-------|-----------|---------|
| Desktop shell | Electron | ^30.0.0 |
| Build tool | electron-vite | ^2.3.0 |
| UI framework | React | ^18.3.0 |
| Language | TypeScript | ^5.4.0 |
| Database | better-sqlite3 | ^9.4.0 |
| State management | Zustand | ^4.5.0 |
| Styling | Tailwind CSS | ^3.4.0 |
| Testing (unit) | Vitest | ^1.6.0 |
| Testing (e2e) | Playwright | ^1.44.0 |
| Packaging | electron-builder | ^24.13.0 |
| AI | @anthropic-ai/sdk | ^0.24.0 |

## Repository Structure

```
lexis/
├── CLAUDE.md                    ← this file
├── docs/
│   ├── BRD.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── API_CONTRACTS.md
│   └── IMPLEMENTATION_PLAN.md
├── electron/
│   ├── main.ts                  ← Electron main process entry
│   ├── preload.ts               ← contextBridge (IPC whitelist)
│   └── services/
│       ├── db.ts                ← SQLite singleton + migrations
│       ├── dictionary.ts        ← Lookup engine + cache
│       ├── srs.ts               ← SM-2 scheduling engine
│       ├── ai.ts                ← Anthropic SDK wrapper
│       ├── audio.ts             ← Forvo + TTS audio
│       └── parsers/
│           ├── srt.ts           ← .srt subtitle parser
│           ├── ass.ts           ← .ass/.ssa subtitle parser
│           ├── epub.ts          ← EPUB parser
│           └── web.ts           ← Web article extractor (Readability)
├── src/
│   ├── main.tsx                 ← React entry point
│   ├── App.tsx                  ← Root component + layout
│   ├── components/
│   │   ├── Reader/
│   │   │   ├── ReaderPanel.tsx
│   │   │   ├── SentenceRow.tsx
│   │   │   └── SubtitleTimeline.tsx
│   │   ├── Lookup/
│   │   │   ├── LookupPanel.tsx
│   │   │   ├── DefinitionCard.tsx
│   │   │   └── AudioButton.tsx
│   │   ├── CardBuilder/
│   │   │   ├── CardBuilder.tsx
│   │   │   ├── CardPreview.tsx
│   │   │   └── TemplateEditor.tsx
│   │   ├── Stats/
│   │   │   ├── StatsDashboard.tsx
│   │   │   └── StreakCard.tsx
│   │   └── shared/
│   │       ├── StatusBar.tsx
│   │       └── StatusBar.tsx
│   ├── store/
│   │   ├── readerStore.ts
│   │   ├── lookupStore.ts
│   │   ├── cardStore.ts
│   │   └── settingsStore.ts
│   ├── hooks/
│   │   ├── useWordSelection.ts
│   │   └── useHotkeys.ts
│   └── types/
│       └── index.ts             ← All shared TypeScript types
├── assets/
│   └── dicts/                   ← Bundled dictionary SQLite files (gitignored, downloaded at build)
├── scripts/
│   ├── build-dict.ts            ← Download + build dictionary DBs
│   └── migrate.ts               ← Run DB migrations
├── electron-builder.yml
├── vite.config.ts
└── package.json
```

## Critical Architecture Rules

### IPC Security Model
- The renderer process (React) MUST NEVER call Node.js APIs directly.
- ALL Node.js/native operations go through `electron/preload.ts` via `contextBridge.exposeInMainWorld`.
- The preload file exposes a `window.lexis` API object — see `docs/API_CONTRACTS.md` for the full interface.
- Main process handles: file I/O, SQLite, HTTP requests (Forvo, Anthropic/OpenAI), audio file management, and SRS persistence.
- Renderer handles: all UI state, user interactions, display logic.

### State Management Rules
- Use Zustand stores for global UI state.
- Do NOT put database query results directly in Zustand — use local component state with `useEffect` for data fetching through the IPC bridge.
- Exception: `settingsStore` is persisted to `electron-store` (user preferences).

### Error Handling Pattern
Every IPC call returns `{ data: T | null, error: string | null }`. Never throw across IPC boundaries. Always check error in the renderer before using data.

```typescript
// Pattern to follow in ALL renderer components:
const result = await window.lexis.dictionary.lookup(word, lang);
if (result.error) {
  // handle gracefully, show user-facing message
  return;
}
// use result.data safely
```

### Database Access
- NEVER open SQLite connections in the renderer process.
- ALL DB operations happen in `electron/services/db.ts` via IPC.
- Use WAL mode for all databases: `PRAGMA journal_mode=WAL`.
- Dictionary DBs are READ-ONLY after build time — open with `{ readonly: true }`.

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (hot reload)
npm run dev

# Build dictionaries (run once after clone)
npm run build:dicts

# Run unit tests
npm run test

# Run e2e tests (requires built app)
npm run test:e2e

# Type check
npm run typecheck

# Build production app
npm run build

# Package for current platform
npm run dist
```

## Environment Variables

Create `.env` at project root (gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...    # Optional — users can also set in Settings UI
FORVO_API_KEY=...               # Optional — falls back to Web Speech TTS
```

## Sprint Execution Order

Implement features in this exact order. Do NOT skip ahead or implement out of order.

1. **Sprint 1**: Project scaffolding, DB setup, SRT parser, basic Reader UI
2. **Sprint 2**: Dictionary engine (JMdict + CEDICT), LookupPanel, audio
3. **Sprint 3**: Built-in SRS decks/cards, CardBuilder, hotkeys
4. **Sprint 4**: Review session and deck picker
5. **Sprint 5**: AI features and EPUB reader
6. **Sprint 6**: Deck browser, stats dashboard, settings, packaging, polish

See `docs/IMPLEMENTATION_PLAN.md` for detailed task breakdown per sprint.

## Code Quality Standards

- All functions must have TypeScript return types. No implicit `any`.
- Components must be under 200 lines. Extract sub-components if longer.
- Every service function in `electron/services/` must have a corresponding unit test in `__tests__/`.
- Use `// TODO(sprint-N):` comments for features planned in later sprints to avoid scope creep.
- Prefer `async/await` over promise chains. Never use callbacks.
- Name IPC channels as `service:action` (e.g., `dictionary:lookup`, `cards:create`).

## Known Constraints

- JMdict and CEDICT dictionary files are NOT in the git repo. Run `npm run build:dicts` to download and build them.
- Lexis uses built-in decks/cards with SM-2 scheduling. There is no required AnkiConnect dependency in the v2 direction.
- EPUB DRM files will NOT parse. Display a clear error message — do not attempt to strip DRM.
- Audio files from Forvo are cached in `{userData}/audio-cache/`. This directory is NOT gitignored (it doesn't exist in the repo, it's created at runtime).

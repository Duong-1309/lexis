# Lexis

Desktop app for sentence mining and language learning with built-in SRS flashcards.

## What is Lexis?

Lexis helps language learners acquire vocabulary through **sentence mining** — the practice of collecting real sentences from content you enjoy, then turning them into flashcards for spaced repetition review.

Import subtitles, ebooks, or web articles. Click any word to see its definition. Create flashcards with one keystroke. Practice active production with AI-powered pattern drills. All offline, no account required.

## Features

### Content Import
- **Subtitles**: SRT, ASS/SSA formats
- **Ebooks**: EPUB (DRM-free)
- **Web articles**: Paste URL, extracts readable text
- **Plain text**: Paste any text directly

### Dictionary & Lookup
- **Japanese**: JMdict with JLPT levels, kuromoji tokenizer
- **Chinese**: CEDICT with HSK levels
- **English**: WordNet with lemmatization
- Click any word → instant definition with readings/pinyin
- Audio pronunciation (Forvo API or TTS fallback)

### Flashcard System
- Built-in SM-2 spaced repetition algorithm
- Rich cards with native language definitions
- Learning steps: 1min → 10min → graduated
- Deck management, card browser, bulk actions

### Pattern Drills
- Mine grammar patterns from sentences
- Active production practice
- AI-powered correction and feedback
- Convert attempts to review cards

### AI Features (Optional)
- Grammar explanations
- Context-aware translations
- Example sentence generation
- Definition translation to native language
- Requires Anthropic or OpenAI API key

### Motivation System
- Daily streak tracking
- Missions with coin rewards
- Smart reminders for due reviews

## Supported Languages

| Language | Dictionary | Tokenizer |
|----------|-----------|-----------|
| Japanese | JMdict | kuromoji |
| Chinese | CEDICT | Character split |
| English | WordNet | Lemmatizer |
| Korean | — | Basic split |
| French | — | Basic split |
| Spanish | — | Basic split |

Native UI languages: Vietnamese, English

## Installation

### Download

Download the latest release for your platform:

- **macOS**: `Lexis-x.x.x.dmg` (Universal: Intel + Apple Silicon)
- **Windows**: `Lexis-Setup-x.x.x.exe`
- **Linux**: `Lexis-x.x.x.AppImage`

### First Launch

1. Open Lexis
2. Select your target language(s) to download dictionaries
3. (Optional) Add your AI API key in Settings for grammar explanations

## Development

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
# Clone
git clone https://github.com/Duong-1309/lexis.git
cd lexis

# Install dependencies
npm install

# Build dictionaries (downloads ~100MB, builds SQLite DBs)
npm run build:dicts

# Run in development mode
npm run dev
```

### Scripts

```bash
npm run dev          # Development with hot reload
npm run build        # Production build
npm run dist         # Package for current platform
npm run dist:mac     # Package for macOS
npm run dist:win     # Package for Windows
npm run dist:linux   # Package for Linux
npm run typecheck    # TypeScript check
npm run test         # Unit tests
npm run test:e2e     # End-to-end tests
```

### Project Structure

```
lexis/
├── electron/           # Main process
│   ├── main.ts         # App entry, IPC handlers
│   ├── preload.ts      # Context bridge API
│   └── services/       # DB, dictionary, AI, audio, parsers
├── src/                # Renderer process (React)
│   ├── components/     # UI components
│   ├── store/          # Zustand stores
│   ├── hooks/          # Custom hooks
│   └── types/          # TypeScript types
├── assets/             # Static assets
├── buildResources/     # App icons
└── docs/               # Documentation
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 30 |
| Build | electron-vite |
| UI | React 18 + Tailwind CSS |
| Database | better-sqlite3 (SQLite) |
| State | Zustand |
| AI | Anthropic SDK / OpenAI SDK |
| Testing | Vitest + Playwright |
| Packaging | electron-builder |

## Data Storage

All data stored locally:

- **Database**: `~/Library/Application Support/Lexis/lexis.db` (macOS)
- **Settings**: `~/Library/Application Support/Lexis/settings.json`
- **Dictionaries**: `~/Library/Application Support/Lexis/dicts/`
- **Audio cache**: `~/Library/Application Support/Lexis/audio-cache/`

No cloud sync. No account. Your data stays on your machine.

## License

[GPL-3.0](LICENSE)

## Acknowledgments

- [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) — Japanese dictionary
- [CC-CEDICT](https://cc-cedict.org/) — Chinese dictionary
- [WordNet](https://wordnet.princeton.edu/) — English dictionary
- [kuromoji](https://github.com/takuyaa/kuromoji.js) — Japanese tokenizer

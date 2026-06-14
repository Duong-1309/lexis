# Business Requirements Document (BRD)
# Lexis — Sentence Mining & Anki Desktop App

**Version:** 1.0  
**Status:** Approved  
**Date:** 2025-01  
**Author:** Product Team  

---

## 1. Executive Summary

Lexis is a desktop application that eliminates the friction between consuming foreign language content and creating high-quality Anki flashcards. The core insight is that the best flashcards come from real content the learner is already engaging with — but the current workflow of switching between a media player, dictionary, and Anki breaks immersion and takes 2–3 minutes per word. Lexis collapses this into a single application where the entire cycle — read, look up, build card, sync — takes under 20 seconds.

---

## 2. Problem Statement

### 2.1 Current User Pain Points

| Pain Point | Impact | Frequency |
|-----------|--------|-----------|
| Switching between 4+ apps per mining session | High context-switching cost | Every session |
| Manual copy-paste of sentences into Anki | ~45 seconds per card | Every card |
| Losing reading position when looking up words | Breaks immersion | Multiple times/session |
| No de-duplication of mined words | Duplicate cards in Anki deck | Weekly |
| No record of what media a word came from | Cards lack context | Every card |
| Audio pronunciation requires separate lookup | Additional 30s per card | ~50% of cards |

### 2.2 Quantified Problem

A learner mining 20 words per day currently spends approximately:
- 2–3 minutes per word × 20 words = **40–60 minutes per day** just on card creation
- Target with Lexis: 20 seconds per word × 20 words = **7 minutes per day**
- **Time saved: 33–53 minutes per day**

---

## 3. Business Objectives

| ID | Objective | KPI | Target |
|----|-----------|-----|--------|
| BO-01 | Reduce card creation time | Seconds from highlight to Anki sync | < 20 seconds |
| BO-02 | Single-app workflow | Number of external apps needed during mining | 0 |
| BO-03 | Multi-language support | Languages supported at launch | JP, ZH, KR, EN, FR, ES |
| BO-04 | Data locality | % of user data stored locally | 100% (except opt-in AI) |
| BO-05 | Offline usability | Core features available offline | Reader + Dictionary + Card queue |

---

## 4. Scope

### 4.1 In Scope — MVP (v1.0)

- Subtitle reader (.srt, .ass formats)
- EPUB ebook reader (DRM-free)
- Web article import (via URL)
- Integrated dictionary (JMdict for Japanese, CC-CEDICT for Chinese, wiktionary for others)
- Word lookup on double-click/selection
- Audio pronunciation (Forvo API + TTS fallback)
- Anki card creation with Basic and Cloze templates
- AnkiConnect sync (add notes, check duplicates)
- Card queue with offline buffering
- Hotkey-driven workflow (Shift+A to mine)
- Basic mining history and statistics

### 4.2 In Scope — v1.1

- AI grammar explanation (Claude API — BYOK)
- AI context-aware translation
- AI-generated example sentences
- Screenshot/image capture for cards
- Mining streak and detailed analytics

### 4.3 Out of Scope

- Mobile app (future consideration)
- Video playback with embedded subtitles (subtitle file import only)
- DRM-protected ebook support (legal constraint)
- PDF reader (complex layout, defer to v2)
- Spaced repetition engine (defer to Anki, not replacing it)
- Cloud sync of user data
- Monetization / subscription features

---

## 5. User Personas

### Persona A: "The Immersion Learner" (Primary)
- **Profile:** Adult learner (20–35), learning Japanese or Chinese, B1–B2 level
- **Behavior:** Watches anime/dramas with subtitles, reads light novels, does Anki daily
- **Pain point:** Current workflow breaks immersion constantly
- **Goal:** Mine 15–30 words per day from real content
- **Technical comfort:** Medium — comfortable with Anki, not a developer

### Persona B: "The Polyglot Student"
- **Profile:** University student, learning 2+ languages simultaneously
- **Behavior:** Reads academic texts and news articles, creates many cards
- **Pain point:** No unified tool across languages
- **Goal:** Consistent workflow regardless of target language
- **Technical comfort:** High — may use API keys, comfortable with settings

### Persona C: "The Casual Learner"
- **Profile:** Adult (30–50), learning one language casually
- **Behavior:** Reads novels occasionally, low card volume (5–10/day)
- **Pain point:** Too many tools to learn
- **Goal:** Simple, guided experience
- **Technical comfort:** Low — needs clear onboarding

---

## 6. Functional Requirements

### 6.1 Reader Module

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-R01 | Import .srt subtitle files | P1 | File dialog opens, file parses without errors, sentences render in order |
| FR-R02 | Import .ass/.ssa subtitle files | P1 | Same as FR-R01, ASS tags stripped from display |
| FR-R03 | Import EPUB files (DRM-free) | P1 | Chapters listed, text renders, images display |
| FR-R04 | Import web article by URL | P2 | URL input field, Readability.js extracts main content |
| FR-R05 | Word selection triggers lookup | P1 | Double-click or text selection → LookupPanel populates within 150ms |
| FR-R06 | Sentence highlight persists | P1 | Selected sentence stays highlighted until user selects another |
| FR-R07 | Reading progress saved | P2 | App remembers last position per media file on next open |
| FR-R08 | Already-mined words marked | P2 | Words in sentences that have been mined show visual indicator |

### 6.2 Dictionary & Lookup Module

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-D01 | Japanese lookup (JMdict) | P1 | Returns readings, definitions, JLPT level, POS for any JMdict entry |
| FR-D02 | Chinese lookup (CC-CEDICT) | P1 | Returns pinyin, traditional/simplified, definitions |
| FR-D03 | General language lookup (wiktionary) | P2 | Returns definitions for EN/FR/ES/KR via wiktionary API |
| FR-D04 | Lookup response time | P1 | < 100ms for local dict hit, < 500ms for network lookup |
| FR-D05 | Audio pronunciation | P1 | Plays audio for looked-up word; Forvo if available, TTS fallback |
| FR-D06 | Multiple dictionary results | P1 | All matching entries shown (e.g. homonyms) |
| FR-D07 | Lookup history | P3 | Last 50 lookups accessible in panel |

### 6.3 Card Builder Module

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-C01 | Auto-populate card from context | P1 | Selected sentence → front field; looked-up definition → back field |
| FR-C02 | Basic card template | P1 | Front: sentence with target word highlighted; Back: reading + definition + audio |
| FR-C03 | Cloze card template | P1 | Target word replaced with [...] on front |
| FR-C04 | Edit card before sending | P1 | Both front and back fields are editable before confirming |
| FR-C05 | Preview rendered card | P1 | WYSIWYG preview matching what Anki will display |
| FR-C06 | Hotkey to create card | P1 | Shift+A creates card from current selection; Ctrl+Enter confirms and sends |
| FR-C07 | Tag card | P2 | Auto-tag with: source name, language, current date. User can add custom tags |
| FR-C08 | Select target Anki deck | P1 | Dropdown of all Anki decks; remembers last used per language |

### 6.4 Anki Integration Module

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-A01 | Connect to AnkiConnect | P1 | Status indicator shows connected/disconnected; auto-retry every 10s |
| FR-A02 | Add note to Anki | P1 | Note appears in selected deck immediately after confirm |
| FR-A03 | Duplicate detection | P1 | Before adding, check if word exists in target deck; warn user |
| FR-A04 | Offline card queue | P1 | Cards created when Anki offline are queued; auto-sync when connection restored |
| FR-A05 | Attach audio file | P1 | Audio file added to Anki media folder and referenced in card |
| FR-A06 | Fetch deck list | P1 | Dropdown populated with all Anki decks |
| FR-A07 | Sync queue status | P2 | UI shows count of pending cards in queue |

### 6.5 AI Module (v1.1)

| ID | Requirement | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| FR-AI01 | Grammar explanation | P2 | User clicks "Explain grammar"; receives sentence breakdown with each element explained |
| FR-AI02 | Context translation | P2 | Translation respects sentence context, not just word-for-word |
| FR-AI03 | Example sentences | P3 | Generate 3 example sentences for target word in appropriate difficulty |
| FR-AI04 | BYOK API key | P2 | User enters Anthropic API key in Settings; stored in OS keychain |
| FR-AI05 | Streaming response | P2 | AI responses stream token-by-token, not wait for full response |

---

## 7. Non-Functional Requirements

### 7.1 Performance

| Metric | Requirement |
|--------|-------------|
| App startup time | < 3 seconds to interactive state |
| Dictionary lookup (local cache hit) | < 50ms |
| Dictionary lookup (DB query) | < 150ms |
| AnkiConnect add note | < 500ms |
| Reader file load (10MB EPUB) | < 2 seconds |
| Memory usage (idle) | < 200MB RAM |
| Memory usage (active session) | < 500MB RAM |

### 7.2 Data & Privacy

- All user-created data (cards, mining history, settings) stored in SQLite at `{app.getPath('userData')}/lexis.db`
- No telemetry, analytics, or user tracking of any kind
- AI API calls: only the selected sentence and looked-up word are sent to Anthropic — never the full document
- Audio files cached locally in `{userData}/audio-cache/`
- Dictionary DBs are bundled read-only data — not user data

### 7.3 Platform Support

| Platform | Minimum Version | Notes |
|----------|----------------|-------|
| Windows | Windows 10 (build 19041) | NSIS installer |
| macOS | macOS 12 Monterey | DMG, signed + notarized for distribution |
| Linux | Ubuntu 20.04+ | AppImage format |

### 7.4 Accessibility

- All interactive elements keyboard-navigable
- Focus indicators visible
- Minimum contrast ratio 4.5:1 for text
- Reader font size adjustable (12px–24px)

### 7.5 Offline Capability

| Feature | Offline | Requires Internet |
|---------|---------|------------------|
| Reader (all formats) | ✅ | |
| Dictionary lookup (JMdict/CEDICT) | ✅ | |
| Card creation + queue | ✅ | |
| Anki sync | ✅ (localhost) | |
| Audio (Forvo) | | ✅ (unless cached) |
| Audio (TTS) | | ✅ |
| Web article import | | ✅ |
| AI features | | ✅ |
| Wiktionary lookup | | ✅ |

---

## 8. User Stories (Full Backlog)

### Epic 1: Content Import

**US-001** — As a language learner, I want to import a .srt subtitle file so that I can read dialogue from shows I'm watching and mine vocabulary in context.

*Acceptance Criteria:*
- File picker accepts .srt files
- Sentences are displayed in order with timestamps
- Non-dialogue lines (e.g., `[music]`) are displayed but marked differently
- File is stored in the app's media library for future sessions

**US-002** — As a learner, I want to import a DRM-free EPUB ebook so that I can mine vocabulary while reading.

*Acceptance Criteria:*
- File picker accepts .epub files
- Chapters listed in a sidebar
- Text renders with proper formatting (bold, italic preserved)
- Images display inline
- DRM-protected files show a clear error: "This ebook is DRM-protected and cannot be opened"

**US-003** — As a learner, I want to paste a URL to import a web article so that I can mine vocabulary from news and blogs.

*Acceptance Criteria:*
- URL input field in import dialog
- Main article text extracted (ads, navigation stripped)
- Article title and source URL saved with the media entry
- Works with major news sites (test: NHK Web Easy, Le Monde, BBC)

### Epic 2: Word Lookup

**US-004** — As a Japanese learner, I want to double-click any word in a sentence so that I instantly see its reading, meaning, and JLPT level without leaving the app.

*Acceptance Criteria:*
- Double-click selects the word (handles kanji compound words correctly via kuromoji tokenization)
- LookupPanel populates within 150ms
- Shows: kanji form, all readings (hiragana), all meanings grouped by POS, JLPT level badge
- Shows example sentences from JMdict if available

**US-005** — As a learner, I want to hear the pronunciation of any looked-up word so that my Anki cards include audio I've verified is correct.

*Acceptance Criteria:*
- Audio button appears on every lookup result
- Clicking plays audio immediately (< 200ms to start playing)
- If Forvo has audio: plays Forvo recording
- If not: plays Web Speech API TTS
- Audio file is cached locally after first play

### Epic 3: Card Creation

**US-006** — As a learner, I want to press Shift+A after looking up a word to generate a pre-filled Anki card so that I can review and send it in under 10 seconds.

*Acceptance Criteria:*
- Hotkey works whenever the LookupPanel shows a result
- Card Builder opens pre-filled: Front = sentence with word highlighted, Back = reading + definition + audio
- Pressing Ctrl+Enter sends immediately; pressing Escape cancels
- Success toast shows: "Card added to [deck name]"

**US-007** — As a learner, I want to see a WYSIWYG preview of my card before sending it so that I can verify it looks correct in Anki.

*Acceptance Criteria:*
- Preview panel shows front and back as they will appear in Anki
- Word in front is highlighted/bolded
- Audio icon shown if audio attached
- Preview updates in real-time as user edits fields

**US-008** — As a learner, I want my cards to be automatically tagged with the source media name and date so that I can filter my Anki deck by source later.

*Acceptance Criteria:*
- Auto-tags applied: `lexis`, `{source-name-slugified}`, `{YYYY-MM}`, `{language}`
- Tags visible in Card Builder before sending
- User can add or remove tags before sending
- Tags appear correctly in Anki after sync

### Epic 4: Anki Sync

**US-009** — As a learner, I want the app to queue my cards when Anki is closed so that I don't lose cards if I mine without Anki running.

*Acceptance Criteria:*
- Status bar shows "Anki offline — X cards queued" when AnkiConnect unreachable
- Cards saved to `cards_queue` table with `synced = false`
- When Anki comes online, queued cards sync automatically within 30 seconds
- Status bar updates to "Synced" with card count after successful sync

**US-010** — As a learner, I want the app to warn me if a word I'm about to add already exists in my Anki deck so that I don't create duplicates.

*Acceptance Criteria:*
- Before adding, app calls AnkiConnect `findNotes` with the word
- If duplicate found: shows warning "This word may already be in your deck" with option to view existing note or add anyway
- Duplicate check completes in < 300ms
- Warning is non-blocking (user can still add if they choose)

---

## 9. Constraints & Assumptions

### Constraints
1. App will NOT strip DRM from ebook files — legal constraint
2. Users must have Anki installed separately and AnkiConnect add-on enabled
3. Forvo API key required for Forvo audio (free tier available)
4. AI features require user to supply their own Anthropic API key (BYOK)
5. Dictionary data (JMdict, CC-CEDICT) is publicly licensed but large (~150MB bundled)

### Assumptions
1. Target users have Anki 2.1.49+ installed
2. Target users are familiar with Anki's basic concepts (decks, cards, templates)
3. Japanese tokenization accuracy acceptable via kuromoji (not 100% but sufficient for mining)
4. Network available for initial dictionary download during setup
5. Users accept that AI calls send sentence text to Anthropic's API

---

## 10. Dependencies

| Dependency | Type | Risk | Mitigation |
|------------|------|------|------------|
| AnkiConnect add-on | External | Medium | App works without it; cards queue locally |
| Forvo API | External | Low | TTS fallback always available |
| Anthropic API | External | Low | AI features are opt-in; app fully functional without |
| JMdict license | Data | Low | Public domain; download at build time |
| CC-CEDICT license | Data | Low | Creative Commons; download at build time |
| kuromoji (JP tokenizer) | NPM | Low | Stable, widely used library |
| epubjs | NPM | Medium | Test against variety of EPUB files |

---

## 11. Success Metrics (Post-Launch)

| Metric | Measurement Method | Target (3 months) |
|--------|-------------------|-------------------|
| Cards created per user per day | Local analytics (opt-in) | > 15 cards/day |
| Time per card | Measure from hotkey to Anki confirm | < 20 seconds median |
| Session length | Time with app in focus | > 20 min/session |
| Anki sync success rate | Failed syncs / total attempts | > 99% |
| App crash rate | Crash reports (opt-in) | < 0.1% of sessions |

---

*End of BRD v1.0*

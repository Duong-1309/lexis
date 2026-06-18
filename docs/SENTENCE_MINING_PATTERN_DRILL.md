# Sentence Mining + Pattern Drill — Product Workflow

`docs/SENTENCE_MINING_PATTERN_DRILL.md`

---

## North Star

Lexis is not only a flashcard app. Lexis is a workflow for:

```text
real input -> sentence mining -> pattern extraction -> active production
-> AI correction -> saved mistakes/corrections -> SRS review
```

Cards, decks, and SM-2 are the memory layer. The core learning loop is active:
users should repeatedly produce language, receive feedback, and review their own
corrected output.

---

## Learning Objects

### Sentence

A sentence is the primary mining unit. It preserves context from subtitles,
EPUB chapters, pasted text, or web articles.

Important fields:

- original sentence
- source media
- language
- position/chapter/timestamp
- selected word or phrase
- native translation when available

### Word Card

Use when the main value is vocabulary.

Example:

```text
Sentence: I suddenly realized I had left my keys at home.
Target: suddenly

Front: suddenly
Back:
  Đột ngột, bất chợt.
  happening unexpectedly; quickly and without warning
  I suddenly realized I had left my keys at home.
```

### Sentence Card

Use when the full expression is useful and natural.

Common prompts:

- cloze deletion
- native-language recall
- sentence reconstruction
- listen-and-recall

Example:

```text
Front:
  Tôi chợt nhận ra mình đã để quên chìa khóa ở nhà.

Back:
  I suddenly realized I had left my keys at home.
```

### Pattern

A pattern is a reusable structure extracted from one or more mined sentences.

Examples:

- `end up + V-ing`
- `realize (that) + clause`
- `leave something at/in somewhere`
- `not only ... but also ...`

Pattern fields:

- pattern text
- native meaning
- short explanation
- language
- example sentences
- linked cards/decks

### Pattern Drill

A drill asks the user to produce a new sentence using a pattern.

Drill types:

- `translation`: native prompt -> target-language answer
- `transform`: base sentence -> transformed sentence using pattern
- `substitution`: slot values -> sentence using pattern
- `free_production`: user creates any sentence with the pattern
- `cloze`: fill missing word/phrase/pattern slot

---

## Mining Decision Flow

When a user selects a word, phrase, or sentence, Lexis should ask:

```text
Why is this worth mining?

[Word] [Sentence] [Pattern]
```

### Mine as Word

Use when:

- target word is unknown
- dictionary definition is the main value
- audio pronunciation matters

App prefill:

- word
- reading/pronunciation
- native definition
- English/source definition
- source sentence
- audio word
- deck/tags

### Mine as Sentence

Use when:

- sentence is natural and worth imitating
- phrase/collocation matters more than one word
- learner wants output recall

App prefill:

- full sentence
- native translation
- cloze target from selection
- source metadata

### Mine as Pattern

Use when:

- the sentence contains reusable structure
- user wants to produce new sentences with the same grammar/phrase
- app should save future drill prompts and attempts

App prefill:

- selected phrase/sentence
- suggested pattern candidates
- explanation
- example sentence
- initial drill prompt

---

## Active Production Flow

Pattern Drill is an output-first loop.

```text
Pattern selected
-> app generates/loads prompt
-> user writes or says an answer
-> app checks answer
-> app gives correction and explanation
-> user retries or accepts correction
-> app saves attempt
-> attempt becomes review material
```

Example:

```text
Pattern:
  end up + V-ing

Prompt:
  Cuối cùng tôi phải làm việc muộn.

User answer:
  I ended up work late.

Correction:
  I ended up working late.

Feedback:
  Use V-ing after "end up", so "work" becomes "working".
```

Saved attempt:

- prompt
- user answer
- corrected answer
- feedback
- score
- mistake types
- pattern id
- source sentence id
- optional generated review card

---

## Evaluation Rubric

---

## Sprint 7 Implementation Notes

Closed on 2026-06-18 after manual runtime testing.

### Selection Routing

Reader selection is intentionally source-agnostic:

- single-word selection routes to dictionary/native word definition
- phrase or sentence selection routes to AI actions: Translate, Explain Grammar, Examples
- subtitle and EPUB use the same selection path
- multilingual punctuation and long CJK/Hangul selections are treated as sentence/phrase mining

The app should not call sentence translation automatically. AI runs only when the
user chooses an action. Captured AI outputs are reused by PatternBuilder so a
user does not pay or wait twice for the same selected text.

### Pattern Save Rules

Pattern duplicate detection runs before save and again at save time.
The duplicate key normalizes:

- case
- punctuation and symbols
- repeated whitespace
- leading/trailing punctuation such as `.`, `,`, quotes, and brackets

The saved display text remains readable, but duplicate checks are stricter than
the visible formatting.

### Reader Highlight Rules

Reader highlight priority is:

```text
mined sentence/pattern highlight > mined word highlight
```

If a mined word appears inside a mined sentence, Lexis highlights only the full
sentence. Hovering a word shows the card tooltip. Hovering a mined sentence
shows the pattern tooltip.

### Drill Review Cards

Pattern Drill review cards are labeled by the learner's produced sentence, not
the original source sentence or pattern text. Source sentence remains secondary
context on the back of the card.

Drill cards are excluded from Reader word-highlight maps so produced sentences
are not mistaken for mined vocabulary.

AI checking should be practical and concise. It should not over-correct style when
the user's answer is already acceptable.

Score dimensions:

- pattern usage
- grammar
- meaning preservation
- naturalness
- spelling/punctuation

Suggested result shape:

```typescript
interface DrillEvaluation {
  score: number // 0-100
  verdict: 'correct' | 'needs_fix' | 'incorrect'
  correctedAnswer: string
  feedback: string
  suggestions: string[]
  examples: string[]
  mistakeTypes: Array<
    | 'pattern'
    | 'verb_form'
    | 'word_order'
    | 'preposition'
    | 'tense'
    | 'meaning'
    | 'naturalness'
    | 'spelling'
  >
}
```

Rules:

- If meaning is correct but phrasing is slightly unnatural, mark `needs_fix`, not
  `incorrect`.
- If the target pattern is missing, mark as `incorrect` or low score even if the
  sentence is grammatical.
- Feedback should name the smallest useful fix.
- Store the user's original mistake; it is valuable review material.

---

## Review Integration

Drill attempts can become SRS cards.

Front:

```text
Use "end up + V-ing":
Cuối cùng tôi phải làm việc muộn.
```

Back:

```text
I ended up working late.

Your old answer:
I ended up work late.

Fix:
Use V-ing after "end up".
```

This makes review personal: the learner reviews their own weak points, not only
generic generated examples.

---

## UX Principle

Mining should stay fast. The app should not force the user to fill a full pattern
form during reading.

Recommended interaction:

1. Select word/phrase/sentence
2. Choose `Word`, `Sentence`, or `Pattern`
3. Accept app prefill
4. Save quickly
5. Drill later in a dedicated session

Deep editing belongs in Pattern Browser / Drill Builder, not the reading flow.

---

## MVP Scope

### MVP 1 — Pattern Foundation

- Add Pattern data model
- Add card type/template distinction: Word, Sentence, Pattern
- Add "Mine as Pattern" action from Reader/Lookup
- Save pattern with source sentence

### MVP 2 — Drill Session

- Prompt -> input -> check -> feedback -> save attempt
- AI non-streaming evaluation endpoint
- Basic drill history

### MVP 3 — SRS Integration

- Create review card from drill attempt
- Link drill attempt to card
- Deck Browser filters by card type/pattern

### Later

- Speech/shadowing checks
- Pattern weakness stats
- Prompt generation from multiple examples
- Custom drill templates
- Import/export pattern decks

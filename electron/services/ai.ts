import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type {
  Language,
  NativeLanguage,
  AIProvider,
  DrillEvaluation,
  DrillEvaluationInput,
} from '../../src/types/index'
import log from 'electron-log'
import type { WebContents } from 'electron'

const LANG_NAMES: Record<Language, string> = {
  ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
  en: 'English', fr: 'French', es: 'Spanish',
}

function isSentenceLike(text: string): boolean {
  const trimmed = text.trim()
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  return /[.!?。！？]$/.test(trimmed) || wordCount > 5
}

export class AIService {
  private provider: AIProvider = 'anthropic'
  private anthropicClient: Anthropic | null = null
  private openaiClient: OpenAI | null = null
  private activeStreams = new Map<string, AbortController>()

  initialize(provider: AIProvider, anthropicKey: string, openaiKey: string): void {
    this.provider = provider
    this.anthropicClient = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null
    this.openaiClient = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null
  }

  hasApiKey(): boolean {
    return this.provider === 'anthropic'
      ? this.anthropicClient !== null
      : this.openaiClient !== null
  }

  async testKey(apiKey: string, provider: AIProvider): Promise<boolean> {
    try {
      if (provider === 'anthropic') {
        const client = new Anthropic({ apiKey })
        await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        })
      } else {
        const client = new OpenAI({ apiKey })
        await client.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        })
      }
      return true
    } catch {
      return false
    }
  }

  explainGrammar(
    sentence: string,
    targetWord: string,
    language: Language,
    streamId: string,
    sender: WebContents,
    nativeLanguage?: NativeLanguage,
  ): void {
    const lang = LANG_NAMES[language] ?? language
    const nativeName = nativeLanguage === 'vi' ? 'Vietnamese' : 'English'
    const isWholeSentence = sentence.trim() === targetWord.trim()
    const unit = isSentenceLike(sentence) ? 'sentence' : 'word/phrase'
    void this.runStream(
      `You are a ${lang} language teacher. Explain in ${nativeName}. Be concise and practical.`,
      isWholeSentence
        ? `Explain this ${lang} ${unit}:\n\n"${sentence}"\n\nCover: meaning, structure, important chunks/patterns, and one key learning point.`
        : `Explain the grammar of "${targetWord}" in this sentence:\n\n"${sentence}"\n\nCover: grammatical form, function in the sentence, and one key learning point.`,
      streamId, sender,
    )
  }

  translateWithContext(
    sentence: string,
    language: Language,
    streamId: string,
    sender: WebContents,
    nativeLanguage?: NativeLanguage,
  ): void {
    const lang = LANG_NAMES[language] ?? language
    const nativeName = nativeLanguage === 'vi' ? 'Vietnamese' : 'English'
    const unit = isSentenceLike(sentence) ? 'sentence' : 'word/phrase'
    void this.runStream(
      `You are a skilled ${lang} translator. Provide natural, accurate translations.`,
      `Translate this ${lang} ${unit} to ${nativeName}. Return the translation first, on its own line. Then optionally add one short note about nuance or idiom:\n\n"${sentence}"`,
      streamId, sender,
    )
  }

  generateExamples(
    word: string,
    language: Language,
    count: number = 3,
    streamId: string,
    sender: WebContents,
    nativeLanguage?: NativeLanguage,
  ): void {
    const lang = LANG_NAMES[language] ?? language
    const nativeName = nativeLanguage === 'vi' ? 'Vietnamese' : 'English'
    const unit = isSentenceLike(word) ? 'pattern/sentence' : 'word/phrase'
    void this.runStream(
      `You are a ${lang} language teacher creating example sentences for vocabulary study.`,
      `Generate ${count} natural ${lang} example sentences using this ${unit}: "${word}". For each, provide the ${lang} sentence and its ${nativeName} translation. Format as a numbered list.`,
      streamId, sender,
    )
  }

  async translateDefinition(
    word: string,
    definition: string,
    _targetLang: Language,
    _nativeLang: NativeLanguage,
  ): Promise<string> {
    if (!this.hasApiKey()) throw new Error('No API key configured')
    const isMultiple = definition.includes('\n') || /^\d+\./.test(definition)
    const prompt = isMultiple
      ? `Dịch các định nghĩa sau sang tiếng Việt tự nhiên, ngắn gọn.

Từ: "${word}"
${definition}

Yêu cầu:
- Giữ nguyên số thứ tự (1. 2. 3.)
- Dịch ý nghĩa, không dịch từng từ
- Dùng cách diễn đạt tự nhiên trong tiếng Việt
- Rất ngắn gọn
- Chỉ trả về các định nghĩa, không thêm gì khác`
      : `Dịch định nghĩa sau sang tiếng Việt tự nhiên, ngắn gọn.

Từ: "${word}"
Định nghĩa: "${definition}"

Chỉ trả về bản dịch, không thêm gì khác.`

    if (this.provider === 'anthropic') {
      const response = await this.anthropicClient!.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      })
      const block = response.content[0]
      if (block.type !== 'text') throw new Error('Unexpected response type')
      return block.text.trim()
    } else {
      const response = await this.openaiClient!.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      })
      return response.choices[0]?.message?.content?.trim() ?? ''
    }
  }

  async evaluateDrillAnswer(input: DrillEvaluationInput): Promise<DrillEvaluation> {
    if (!this.hasApiKey()) throw new Error('No API key configured')
    const langName = LANG_NAMES[input.language] ?? input.language
    const nativeName = input.nativeLanguage === 'vi' ? 'Vietnamese' : 'English'
    const prompt = [
      `Evaluate this ${langName} pattern drill answer for a ${nativeName}-speaking learner.`,
      '',
      `Pattern: ${input.patternText}`,
      `Prompt: ${input.prompt}`,
      input.expectedAnswer ? `Expected answer: ${input.expectedAnswer}` : '',
      `User answer: ${input.userAnswer}`,
      '',
      'Return strict JSON only with this shape:',
      '{"score":number,"verdict":"correct|needs_fix|incorrect","correctedAnswer":"...","feedback":"...","suggestions":["..."],"examples":["..."],"mistakeTypes":["pattern|verb_form|word_order|preposition|tense|meaning|naturalness|spelling"]}',
      '',
      'Rules: missing the target pattern is a major issue; preserve acceptable meaning; keep feedback concise.',
      'Suggestions must be actionable tips in the learner native language. Examples must be 2 short natural target-language sentences using the pattern.',
    ].filter(Boolean).join('\n')

    const text = this.provider === 'anthropic'
      ? await this.completeAnthropic(prompt, 800)
      : await this.completeOpenAI(prompt, 800)
    return this.parseDrillEvaluation(text)
  }

  cancelStream(streamId: string): void {
    const ctrl = this.activeStreams.get(streamId)
    if (ctrl) { ctrl.abort(); this.activeStreams.delete(streamId) }
  }

  private async completeAnthropic(prompt: string, maxTokens: number): Promise<string> {
    const response = await this.anthropicClient!.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = response.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type')
    return block.text.trim()
  }

  private async completeOpenAI(prompt: string, maxTokens: number): Promise<string> {
    const response = await this.openaiClient!.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    return response.choices[0]?.message?.content?.trim() ?? ''
  }

  private parseDrillEvaluation(text: string): DrillEvaluation {
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text
    const parsed = JSON.parse(jsonText) as Partial<DrillEvaluation>
    const verdict = parsed.verdict === 'correct' || parsed.verdict === 'needs_fix' || parsed.verdict === 'incorrect'
      ? parsed.verdict
      : 'needs_fix'

    return {
      score: Math.max(0, Math.min(100, Number(parsed.score ?? 0))),
      verdict,
      correctedAnswer: String(parsed.correctedAnswer ?? ''),
      feedback: String(parsed.feedback ?? ''),
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map(String).filter(Boolean)
        : [],
      examples: Array.isArray(parsed.examples)
        ? parsed.examples.map(String).filter(Boolean)
        : [],
      mistakeTypes: Array.isArray(parsed.mistakeTypes)
        ? parsed.mistakeTypes.map(String)
        : [],
    }
  }

  private async runStream(system: string, userMessage: string, streamId: string, sender: WebContents): Promise<void> {
    if (!this.hasApiKey()) {
      sender.send('ai:stream-error', streamId, 'No API key configured. Add your API key in Settings.')
      return
    }
    const ctrl = new AbortController()
    this.activeStreams.set(streamId, ctrl)
    try {
      if (this.provider === 'anthropic') {
        await this.streamAnthropic(system, userMessage, streamId, sender, ctrl)
      } else {
        await this.streamOpenAI(system, userMessage, streamId, sender, ctrl)
      }
      if (!ctrl.signal.aborted) sender.send('ai:stream-done', streamId)
    } catch (err: unknown) {
      if (!ctrl.signal.aborted) {
        const msg = err instanceof Error ? err.message : 'AI request failed'
        log.error('AI stream error:', msg)
        sender.send('ai:stream-error', streamId, msg)
      }
    } finally {
      this.activeStreams.delete(streamId)
    }
  }

  private async streamAnthropic(system: string, userMessage: string, streamId: string, sender: WebContents, ctrl: AbortController): Promise<void> {
    const stream = this.anthropicClient!.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userMessage }],
    })
    for await (const event of stream) {
      if (ctrl.signal.aborted) break
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        sender.send('ai:stream-chunk', streamId, event.delta.text)
      }
    }
  }

  private async streamOpenAI(system: string, userMessage: string, streamId: string, sender: WebContents, ctrl: AbortController): Promise<void> {
    const stream = await this.openaiClient!.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
      stream: true,
    })
    for await (const chunk of stream) {
      if (ctrl.signal.aborted) break
      const text = chunk.choices[0]?.delta?.content ?? ''
      if (text) sender.send('ai:stream-chunk', streamId, text)
    }
  }
}

export const aiService = new AIService()

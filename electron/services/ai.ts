import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { Language, AIProvider } from '../../src/types/index'
import log from 'electron-log'
import type { WebContents } from 'electron'

const LANG_NAMES: Record<Language, string> = {
  ja: 'Japanese', zh: 'Chinese', ko: 'Korean',
  en: 'English', fr: 'French', es: 'Spanish',
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

  explainGrammar(sentence: string, targetWord: string, language: Language, streamId: string, sender: WebContents): void {
    const lang = LANG_NAMES[language] ?? language
    void this.runStream(
      `You are a ${lang} language teacher. Be concise and practical.`,
      `Explain the grammar of "${targetWord}" in this sentence:\n\n"${sentence}"\n\nCover: grammatical form, function in the sentence, and one key learning point. Be brief.`,
      streamId, sender,
    )
  }

  translateWithContext(sentence: string, language: Language, streamId: string, sender: WebContents): void {
    const lang = LANG_NAMES[language] ?? language
    void this.runStream(
      `You are a skilled ${lang} translator. Provide natural, accurate translations.`,
      `Translate this ${lang} sentence to English and note any cultural nuances or idioms:\n\n"${sentence}"`,
      streamId, sender,
    )
  }

  generateExamples(word: string, language: Language, count: number = 3, streamId: string, sender: WebContents): void {
    const lang = LANG_NAMES[language] ?? language
    void this.runStream(
      `You are a ${lang} language teacher creating example sentences for vocabulary study.`,
      `Generate ${count} natural example sentences using "${word}" in ${lang}. For each, provide the ${lang} sentence and its English translation. Format as a numbered list.`,
      streamId, sender,
    )
  }

  cancelStream(streamId: string): void {
    const ctrl = this.activeStreams.get(streamId)
    if (ctrl) { ctrl.abort(); this.activeStreams.delete(streamId) }
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

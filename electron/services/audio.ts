import path from 'path'
import fs from 'fs'
import https from 'https'
import log from 'electron-log'
import type { Language, AudioResult } from '../../src/types/index'

class AudioService {
  private cacheDir = ''
  private forvoApiKey = ''

  initialize(userDataPath: string): void {
    this.cacheDir = path.join(userDataPath, 'audio-cache')
    fs.mkdirSync(this.cacheDir, { recursive: true })
  }

  setForvoKey(key: string): void {
    this.forvoApiKey = key
  }

  cachedPath(filename: string): string {
    return path.join(this.cacheDir, filename)
  }

  async getAudio(word: string, lang: Language, reading?: string): Promise<AudioResult> {
    const term = reading ?? word
    const filename = `${lang}_${term.replace(/[^\w぀-鿿]/g, '_')}.mp3`
    const cached = path.join(this.cacheDir, filename)

    if (fs.existsSync(cached)) {
      return { filename, source: 'cache' }
    }

    if (this.forvoApiKey) {
      try {
        await this.downloadForvo(word, lang, cached)
        return { filename, source: 'forvo' }
      } catch (e) {
        log.warn('Forvo failed, falling back to TTS:', e)
      }
    }

    // Fallback: signal renderer to use Web Speech TTS
    return { filename: '', source: 'tts' }
  }

  private downloadForvo(word: string, lang: Language, dest: string): Promise<void> {
    const langMap: Partial<Record<Language, string>> = { ja: 'ja', zh: 'zh', ko: 'ko', en: 'en', fr: 'fr', es: 'es' }
    const forvoLang = langMap[lang] ?? lang
    const url = `https://apifree.forvo.com/action/word-pronunciations/format/json/word/${encodeURIComponent(word)}/language/${forvoLang}/key/${this.forvoApiKey}/`

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let body = ''
        res.on('data', (d: Buffer) => { body += d.toString() })
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as { items?: Array<{ pathmp3: string }> }
            const mp3Url = json.items?.[0]?.pathmp3
            if (!mp3Url) { reject(new Error('No Forvo audio')); return }
            this.downloadFile(mp3Url, dest).then(resolve).catch(reject)
          } catch (e) { reject(e) }
        })
      }).on('error', reject)
    })
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close(); fs.unlinkSync(dest)
          this.downloadFile(res.headers.location!, dest).then(resolve).catch(reject)
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
      }).on('error', (e) => { try { fs.unlinkSync(dest) } catch {} reject(e) })
    })
  }
}

export const audioService = new AudioService()

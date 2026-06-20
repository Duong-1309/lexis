import fs from 'fs'
import path from 'path'
import { app, BrowserWindow } from 'electron'
import type { DictionaryId, DictionaryInfo, Language } from '../../src/types/index'
import { buildDictionary } from './dictionary-builder'

// Dictionary metadata
// - jmdict/cedict: Build from source on demand
// - wordnet: Bundled with app
const DICTIONARY_REGISTRY: Record<DictionaryId, Omit<DictionaryInfo, 'downloaded' | 'downloading' | 'progress' | 'updatedAt'>> = {
  jmdict: {
    id: 'jmdict',
    language: 'ja',
    name: 'JMdict (Japanese)',
    description: 'Japanese-English dictionary with 190,000+ entries. Downloads ~10MB source, builds locally.',
    size: 94_000_000,
    sizeFormatted: '~90 MB (built)',
    url: '', // Built from source
    version: '1.0.0',
  },
  cedict: {
    id: 'cedict',
    language: 'zh',
    name: 'CC-CEDICT (Chinese)',
    description: 'Chinese-English dictionary with 120,000+ entries. Downloads ~4MB source, builds locally.',
    size: 22_000_000,
    sizeFormatted: '~21 MB (built)',
    url: '', // Built from source
    version: '1.0.0',
  },
  wordnet: {
    id: 'wordnet',
    language: 'en',
    name: 'WordNet (English)',
    description: 'English lexical database with definitions and relations. Bundled with app.',
    size: 46_000_000,
    sizeFormatted: '44 MB',
    url: '', // Bundled
    version: '1.0.0',
  },
}

// Dictionaries that are built from source (not pre-built downloads)
const BUILD_FROM_SOURCE: DictionaryId[] = ['jmdict', 'cedict']

// Dictionaries that are bundled with the app (cannot be deleted)
const BUNDLED_DICTS: DictionaryId[] = ['wordnet']

const LANGUAGE_TO_DICT: Record<Language, DictionaryId | null> = {
  ja: 'jmdict',
  zh: 'cedict',
  en: 'wordnet',
  ko: null, // Not yet supported
  fr: null,
  es: null,
}

interface ManifestData {
  dictionaries: Record<string, { version: string; downloadedAt: string }>
}

class DictionaryDownloadService {
  private dictsDir: string = ''
  private bundledDictsDir: string = ''
  private manifestPath: string = ''
  private downloading: Set<DictionaryId> = new Set()
  private progressCallbacks: Map<DictionaryId, number> = new Map()

  initialize(userDataPath: string): void {
    this.dictsDir = path.join(userDataPath, 'dicts')
    this.manifestPath = path.join(userDataPath, 'dict-manifest.json')

    // Bundled dicts location - differs between dev and production
    // In dev: out/main/ -> ../../assets/dicts
    // In prod: resources/dicts (if bundled via extraResources)
    this.bundledDictsDir = app.isPackaged
      ? path.join(process.resourcesPath, 'dicts')
      : path.join(__dirname, '../../assets/dicts')

    if (!fs.existsSync(this.dictsDir)) {
      fs.mkdirSync(this.dictsDir, { recursive: true })
    }
  }

  getDictsDir(): string {
    return this.dictsDir
  }

  getBundledDictsDir(): string {
    return this.bundledDictsDir
  }

  private getManifest(): ManifestData {
    if (!fs.existsSync(this.manifestPath)) {
      return { dictionaries: {} }
    }
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'))
    } catch {
      return { dictionaries: {} }
    }
  }

  private saveManifest(manifest: ManifestData): void {
    fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2))
  }

  /**
   * Check if dictionary is available from user data or bundled location
   */
  isDictionaryDownloaded(id: DictionaryId): boolean {
    // Check user data directory first
    const userPath = path.join(this.dictsDir, `${id}.db`)
    if (fs.existsSync(userPath)) return true

    // Check bundled directory (dev or production)
    const bundledPath = path.join(this.bundledDictsDir, `${id}.db`)
    return fs.existsSync(bundledPath)
  }

  /**
   * Get dictionary path from user data or bundled location
   */
  getDictionaryPath(id: DictionaryId): string | null {
    // Prefer user data directory
    const userPath = path.join(this.dictsDir, `${id}.db`)
    if (fs.existsSync(userPath)) return userPath

    // Fall back to bundled
    const bundledPath = path.join(this.bundledDictsDir, `${id}.db`)
    if (fs.existsSync(bundledPath)) return bundledPath

    return null
  }

  /**
   * Check if dictionary is available in user data (not bundled)
   */
  isDictionaryInUserData(id: DictionaryId): boolean {
    const userPath = path.join(this.dictsDir, `${id}.db`)
    return fs.existsSync(userPath)
  }

  /**
   * Check if dictionary is bundled with the app
   */
  isDictionaryBundled(id: DictionaryId): boolean {
    const bundledPath = path.join(this.bundledDictsDir, `${id}.db`)
    return fs.existsSync(bundledPath)
  }

  getDictIdForLanguage(language: Language): DictionaryId | null {
    return LANGUAGE_TO_DICT[language] ?? null
  }

  isDictionaryAvailableForLanguage(language: Language): boolean {
    const dictId = this.getDictIdForLanguage(language)
    if (!dictId) return false
    return this.isDictionaryDownloaded(dictId)
  }

  listDictionaries(): DictionaryInfo[] {
    const manifest = this.getManifest()

    return Object.values(DICTIONARY_REGISTRY).map((dict) => {
      const isInUserData = this.isDictionaryInUserData(dict.id)
      const isBundledDict = BUNDLED_DICTS.includes(dict.id)
      const isBundledAvailable = this.isDictionaryBundled(dict.id)

      // For bundled dicts (wordnet): check both user data and bundled location
      // For on-demand dicts (jmdict, cedict): only check user data
      const isDownloaded = isBundledDict
        ? (isInUserData || isBundledAvailable)
        : isInUserData

      // Determine source
      let source: 'user' | 'bundled' | undefined
      if (isInUserData) {
        source = 'user'
      } else if (isBundledDict && isBundledAvailable) {
        source = 'bundled'
      }

      return {
        ...dict,
        downloaded: isDownloaded,
        downloading: this.downloading.has(dict.id),
        progress: this.progressCallbacks.get(dict.id) ?? 0,
        updatedAt: manifest.dictionaries[dict.id]?.downloadedAt,
        bundled: isBundledDict && isBundledAvailable,
        source,
      }
    })
  }

  async downloadDictionary(id: DictionaryId, mainWindow: BrowserWindow | null): Promise<void> {
    if (this.downloading.has(id)) {
      throw new Error(`Dictionary ${id} is already downloading`)
    }

    const registry = DICTIONARY_REGISTRY[id]
    if (!registry) {
      throw new Error(`Unknown dictionary: ${id}`)
    }

    const finalPath = path.join(this.dictsDir, `${id}.db`)

    // Build from source for jmdict/cedict (always, even if bundled exists in dev)
    if (BUILD_FROM_SOURCE.includes(id)) {
      this.downloading.add(id)
      this.progressCallbacks.set(id, 0)

      try {
        await buildDictionary(id, this.dictsDir, mainWindow)

        // Update manifest
        const manifest = this.getManifest()
        manifest.dictionaries[id] = {
          version: registry.version,
          downloadedAt: new Date().toISOString(),
        }
        this.saveManifest(manifest)

        mainWindow?.webContents.send('dictionary:download-complete', { id })
      } catch (error) {
        mainWindow?.webContents.send('dictionary:download-error', {
          id,
          error: error instanceof Error ? error.message : 'Build failed',
        })
        throw error
      } finally {
        this.downloading.delete(id)
        this.progressCallbacks.delete(id)
      }
      return
    }

    // For wordnet without bundled file - this shouldn't happen in production
    throw new Error(`Dictionary ${id} is not available. It should be bundled with the app.`)
  }

  /**
   * Copy file with progress reporting
   */
  private copyFile(
    srcPath: string,
    destPath: string,
    onProgress: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const stat = fs.statSync(srcPath)
      const totalSize = stat.size
      let copiedSize = 0

      const readStream = fs.createReadStream(srcPath)
      const writeStream = fs.createWriteStream(destPath)

      readStream.on('data', (chunk: Buffer) => {
        copiedSize += chunk.length
        const progress = Math.round((copiedSize / totalSize) * 100)
        onProgress(progress)
      })

      readStream.on('error', (err) => {
        writeStream.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        reject(err)
      })

      writeStream.on('error', (err) => {
        readStream.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        reject(err)
      })

      writeStream.on('finish', () => {
        resolve()
      })

      readStream.pipe(writeStream)
    })
  }

  deleteDictionary(id: DictionaryId): void {
    const dbPath = path.join(this.dictsDir, `${id}.db`)
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }

    // Remove from manifest
    const manifest = this.getManifest()
    delete manifest.dictionaries[id]
    this.saveManifest(manifest)
  }
}

export const dictDownloadService = new DictionaryDownloadService()

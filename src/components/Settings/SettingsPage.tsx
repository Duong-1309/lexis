import { useEffect, useState } from 'react'
import type { AIProvider, CardTemplate, NativeLanguage, UserSettings, UpdateInfo } from '../../types'
import { COMMON_TIME_ZONES, DEFAULT_TIME_ZONE } from '../../utils/time'
import { DictionaryManager } from './DictionaryManager'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'error' | 'up-to-date'

interface SettingsPageProps {
  onClose: () => void
}

type SettingsTab = 'general' | 'ai' | 'review' | 'reader'

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI & API',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'review',
    label: 'Review',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: 'reader',
    label: 'Reader',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
]

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

type KeyStatus = 'idle' | 'testing' | 'ok' | 'fail'

function parseStepInput(value: string): number[] {
  const steps = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((step) => Number.isFinite(step) && step > 0)
  return steps.length > 0 ? steps : [1, 10]
}

function formatStepInput(steps: number[]): string {
  return steps.join(', ')
}

function ApiKeyField({
  label,
  value,
  placeholder,
  hint,
  status,
  onChange,
  onTest,
}: {
  label: string
  value: string
  placeholder: string
  hint: string
  status: KeyStatus
  onChange: (v: string) => void
  onTest: () => void
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          type="password"
          className="flex-1 px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          onClick={onTest}
          disabled={status === 'testing' || !value.trim()}
          className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {status === 'testing' ? '...' : 'Test'}
        </button>
      </div>
      {status === 'ok' && <p className="mt-1 text-xs text-green-400">Valid</p>}
      {status === 'fail' && <p className="mt-1 text-xs text-red-400">Invalid key</p>}
    </Field>
  )
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [settings, setLocalSettings] = useState<UserSettings | null>(null)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [forvoKey, setForvoKey] = useState('')
  const [learningStepsInput, setLearningStepsInput] = useState('1, 10')
  const [anthropicStatus, setAnthropicStatus] = useState<KeyStatus>('idle')
  const [openaiStatus, setOpenaiStatus] = useState<KeyStatus>('idle')
  const [saving, setSaving] = useState(false)

  // Update state
  const [appVersion, setAppVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  // Cache state
  const [cacheSize, setCacheSize] = useState<{ translation: number; audio: number } | null>(null)
  const [clearingCache, setClearingCache] = useState<'translation' | 'audio' | null>(null)

  useEffect(() => {
    window.lexis.updater.getVersion().then((r) => {
      if (r.data) setAppVersion(r.data)
    })

    // Setup update listeners
    window.lexis.updater.onChecking(() => {
      setUpdateStatus('checking')
      setUpdateError(null)
    })
    window.lexis.updater.onAvailable((info) => {
      setUpdateStatus('available')
      setUpdateInfo(info)
    })
    window.lexis.updater.onNotAvailable(() => {
      setUpdateStatus('up-to-date')
    })
    window.lexis.updater.onError((error) => {
      setUpdateStatus('error')
      setUpdateError(error)
    })

    return () => {
      window.lexis.updater.removeListeners()
    }
  }, [])

  useEffect(() => {
    window.lexis.settings.get().then((r) => {
      if (r.data) {
        setLocalSettings(r.data)
        setAnthropicKey(r.data.anthropicApiKey)
        setOpenaiKey(r.data.openaiApiKey)
        setForvoKey(r.data.forvoApiKey)
        setLearningStepsInput(formatStepInput(r.data.scheduling.learningStepsMinutes))
      }
    })
  }, [])

  // Load cache size
  useEffect(() => {
    window.lexis.cache.getSize().then((r) => {
      if (r.data) setCacheSize(r.data)
    })
  }, [])

  const loadCacheSize = async () => {
    const r = await window.lexis.cache.getSize()
    if (r.data) setCacheSize(r.data)
  }

  const handleClearTranslationCache = async () => {
    setClearingCache('translation')
    await window.lexis.cache.clearTranslation()
    await loadCacheSize()
    setClearingCache(null)
  }

  const handleClearAudioCache = async () => {
    setClearingCache('audio')
    await window.lexis.cache.clearAudio()
    await loadCacheSize()
    setClearingCache(null)
  }

  const testKey = async (key: string, provider: AIProvider, setStatus: (s: KeyStatus) => void) => {
    if (!key.trim()) return
    setStatus('testing')
    const r = await window.lexis.settings.testAIKey(key.trim(), provider)
    setStatus(r.data ? 'ok' : 'fail')
  }

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking')
    setUpdateError(null)
    await window.lexis.updater.checkForUpdates()
  }

  const handleOpenDownload = () => {
    if (updateInfo?.version) {
      window.lexis.updater.openDownload(updateInfo.version)
    }
  }

  const handleSave = async () => {
    if (!settings) return
    const normalizedSettings: UserSettings = {
      ...settings,
      scheduling: {
        ...settings.scheduling,
        learningStepsMinutes: parseStepInput(learningStepsInput),
      },
    }
    setSaving(true)
    await window.lexis.settings.set({
      ...normalizedSettings,
      anthropicApiKey: anthropicKey.trim(),
      openaiApiKey: openaiKey.trim(),
      forvoApiKey: forvoKey.trim(),
    })
    setLocalSettings(normalizedSettings)
    setLearningStepsInput(formatStepInput(normalizedSettings.scheduling.learningStepsMinutes))
    setSaving(false)
    // Auto-close after save
    onClose()
  }

  if (!settings) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="text-gray-500 text-sm">Loading settings...</div>
      </div>
    )
  }

  const setProvider = (p: AIProvider) => setLocalSettings({ ...settings, aiProvider: p })
  const setNativeLanguage = (nativeLanguage: NativeLanguage) =>
    setLocalSettings({ ...settings, nativeLanguage })
  const setScheduling = (updates: Partial<UserSettings['scheduling']>) =>
    setLocalSettings({ ...settings, scheduling: { ...settings.scheduling, ...updates } })
  const setReminders = (updates: Partial<UserSettings['reminders']>) =>
    setLocalSettings({ ...settings, reminders: { ...settings.reminders, ...updates } })
  const setCardSettings = (updates: Partial<UserSettings['cards']>) =>
    setLocalSettings({ ...settings, cards: { ...settings.cards, ...updates } })
  const timeZones = settings.timeZone && !COMMON_TIME_ZONES.includes(settings.timeZone)
    ? [settings.timeZone, ...COMMON_TIME_ZONES]
    : COMMON_TIME_ZONES

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6">
            <Field label="Native Language" hint="Used for translations and definitions. Changing clears cache.">
              <div className="flex bg-gray-800 rounded-lg p-1">
                {([
                  ['vi', 'Tiếng Việt'],
                  ['en', 'English'],
                ] as Array<[NativeLanguage, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setNativeLanguage(value)}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      settings.nativeLanguage === value
                        ? 'bg-gray-700 text-gray-100'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Time Zone" hint="Used for due dates and daily stats.">
              <select
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={settings.timeZone || DEFAULT_TIME_ZONE}
                onChange={(e) => setLocalSettings({ ...settings, timeZone: e.target.value })}
              >
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </Field>

            <div className="pt-2">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Dictionaries</h4>
              <DictionaryManager />
            </div>

            <div className="border-t border-white/5 pt-6 mt-6">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Cache</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 px-3 bg-gray-800/60 border border-white/10 rounded-lg">
                  <div>
                    <p className="text-sm text-gray-300">Translation Cache</p>
                    <p className="text-xs text-gray-500">
                      {cacheSize ? formatBytes(cacheSize.translation) : '...'}
                    </p>
                  </div>
                  <button
                    onClick={handleClearTranslationCache}
                    disabled={clearingCache === 'translation' || !cacheSize?.translation}
                    className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {clearingCache === 'translation' ? 'Clearing...' : 'Clear'}
                  </button>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-gray-800/60 border border-white/10 rounded-lg">
                  <div>
                    <p className="text-sm text-gray-300">Audio Cache</p>
                    <p className="text-xs text-gray-500">
                      {cacheSize ? formatBytes(cacheSize.audio) : '...'}
                    </p>
                  </div>
                  <button
                    onClick={handleClearAudioCache}
                    disabled={clearingCache === 'audio' || !cacheSize?.audio}
                    className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {clearingCache === 'audio' ? 'Clearing...' : 'Clear'}
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-white/5 pt-6 mt-6">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">About & Updates</h4>
              <div className="bg-gray-800/60 border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-200">Lexis</p>
                    <p className="text-xs text-gray-500">Version {appVersion || '...'}</p>
                  </div>
                  {updateStatus === 'idle' && (
                    <button
                      onClick={handleCheckForUpdates}
                      className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                    >
                      Check for updates
                    </button>
                  )}
                  {updateStatus === 'checking' && (
                    <span className="text-xs text-gray-500">Checking...</span>
                  )}
                  {updateStatus === 'up-to-date' && (
                    <span className="text-xs text-green-400">Up to date</span>
                  )}
                  {updateStatus === 'available' && (
                    <button
                      onClick={handleOpenDownload}
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                    >
                      Download v{updateInfo?.version}
                    </button>
                  )}
                  {updateStatus === 'error' && (
                    <button
                      onClick={handleCheckForUpdates}
                      className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                    >
                      Retry
                    </button>
                  )}
                </div>

                {/* Release Notes */}
                {updateStatus === 'available' && updateInfo?.releaseNotes && (
                  <div className="mb-3 p-3 bg-gray-900/50 border border-white/5 rounded-lg max-h-40 overflow-y-auto">
                    <p className="text-xs font-medium text-gray-400 mb-1.5">What's new in v{updateInfo.version}:</p>
                    <div className="text-xs text-gray-300 release-notes">
                      {typeof updateInfo.releaseNotes === 'string' ? (
                        <div
                          className="[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-gray-200 [&_h2]:mt-2 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:ml-4 [&_ul]:space-y-0.5 [&_li]:text-gray-300 [&_p]:text-gray-400"
                          dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
                        />
                      ) : (
                        updateInfo.releaseNotes.map((note, i) => (
                          <div key={i} className="mb-1">
                            <span className="text-gray-500">{note.version}:</span>{' '}
                            <span dangerouslySetInnerHTML={{ __html: note.note }} />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {updateStatus === 'error' && updateError && (
                  <p className="text-xs text-red-400">{updateError}</p>
                )}

                <label className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    className="accent-blue-500"
                    checked={settings.checkForUpdates}
                    onChange={(e) => setLocalSettings({ ...settings, checkForUpdates: e.target.checked })}
                  />
                  <span className="text-xs text-gray-400">Automatically check for updates</span>
                </label>
              </div>
            </div>
          </div>
        )

      case 'ai':
        return (
          <div className="space-y-6">
            <Field label="AI Provider">
              <div className="flex bg-gray-800 rounded-lg p-1">
                {(['anthropic', 'openai'] as AIProvider[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      settings.aiProvider === p
                        ? 'bg-gray-700 text-gray-100'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {p === 'anthropic' ? 'Claude' : 'GPT-4o'}
                  </button>
                ))}
              </div>
            </Field>

            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
              settings.aiProvider === 'anthropic'
                ? 'bg-orange-500/10 text-orange-300 border border-orange-500/20'
                : 'bg-green-500/10 text-green-300 border border-green-500/20'
            }`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
              Using <strong className="ml-1">{settings.aiProvider === 'anthropic' ? 'Claude' : 'GPT-4o'}</strong>
            </div>

            <div className="border-t border-white/5 pt-6 space-y-5">
              <ApiKeyField
                label="Anthropic API Key"
                value={anthropicKey}
                placeholder="sk-ant-..."
                hint="console.anthropic.com"
                status={anthropicStatus}
                onChange={(v) => { setAnthropicKey(v); setAnthropicStatus('idle') }}
                onTest={() => testKey(anthropicKey, 'anthropic', setAnthropicStatus)}
              />

              <ApiKeyField
                label="OpenAI API Key"
                value={openaiKey}
                placeholder="sk-..."
                hint="platform.openai.com"
                status={openaiStatus}
                onChange={(v) => { setOpenaiKey(v); setOpenaiStatus('idle') }}
                onTest={() => testKey(openaiKey, 'openai', setOpenaiStatus)}
              />

              <ApiKeyField
                label="Forvo API Key"
                value={forvoKey}
                placeholder="Optional"
                hint="For human audio pronunciations"
                status="idle"
                onChange={setForvoKey}
                onTest={() => {}}
              />
            </div>
          </div>
        )

      case 'review':
        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <Field label="New Cards / Day">
                <input
                  type="number"
                  min={0}
                  max={999}
                  className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                  value={settings.scheduling.newCardsPerDay}
                  onChange={(e) => setScheduling({ newCardsPerDay: Number(e.target.value) })}
                />
              </Field>

              <Field label="Reviews / Day">
                <input
                  type="number"
                  min={0}
                  max={9999}
                  className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                  value={settings.scheduling.reviewsPerDay}
                  onChange={(e) => setScheduling({ reviewsPerDay: Number(e.target.value) })}
                />
              </Field>
            </div>

            <Field label="Learning Steps (minutes)" hint="Comma-separated. E.g., 1, 10">
              <input
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={learningStepsInput}
                onChange={(e) => setLearningStepsInput(e.target.value)}
                onBlur={() => setScheduling({ learningStepsMinutes: parseStepInput(learningStepsInput) })}
                placeholder="1, 10"
              />
            </Field>

            <Field label="Daily Due Time">
              <input
                type="time"
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={settings.scheduling.dailyDueTime}
                onChange={(e) => setScheduling({ dailyDueTime: e.target.value })}
              />
            </Field>

            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-gray-800/60 px-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-blue-500"
                checked={settings.reminders.enabled}
                onChange={(e) => setReminders({ enabled: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-gray-300">Smart Reminders</span>
                <span className="block text-xs text-gray-500">Notify when cards are due or streak at risk</span>
              </span>
            </label>

            <div className="border-t border-white/5 pt-6 space-y-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Cards</h4>

              <Field label="Default Template">
                <select
                  className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                  value={settings.cards.defaultTemplate}
                  onChange={(e) => setCardSettings({ defaultTemplate: e.target.value as CardTemplate })}
                >
                  <option value="Basic">Basic</option>
                  <option value="Cloze">Cloze</option>
                </select>
              </Field>

              <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-gray-800/60 px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-blue-500"
                  checked={settings.cards.showNativeDefinitionFirst}
                  onChange={(e) => setCardSettings({ showNativeDefinitionFirst: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-300">Native definition first</span>
                  <span className="block text-xs text-gray-500">Show Vietnamese as primary answer</span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-gray-800/60 px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-blue-500"
                  checked={settings.cards.autoPlayAudio}
                  onChange={(e) => setCardSettings({ autoPlayAudio: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-300">Auto-play audio</span>
                  <span className="block text-xs text-gray-500">Play pronunciation during review</span>
                </span>
              </label>
            </div>
          </div>
        )

      case 'reader':
        return (
          <div className="space-y-6">
            <Field label="Font Size">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-6">12</span>
                <input
                  type="range"
                  min={12}
                  max={24}
                  step={1}
                  className="flex-1 accent-blue-500"
                  value={settings.readerFontSize}
                  onChange={(e) => setLocalSettings({ ...settings, readerFontSize: Number(e.target.value) })}
                />
                <span className="text-xs text-gray-500 w-6">24</span>
                <span className="w-12 text-sm text-gray-300 text-right font-medium">{settings.readerFontSize}px</span>
              </div>
            </Field>

            <Field label="Line Height">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-6">1.2</span>
                <input
                  type="range"
                  min={1.2}
                  max={2.4}
                  step={0.1}
                  className="flex-1 accent-blue-500"
                  value={settings.readerLineHeight}
                  onChange={(e) => setLocalSettings({ ...settings, readerLineHeight: Number(e.target.value) })}
                />
                <span className="text-xs text-gray-500 w-6">2.4</span>
                <span className="w-12 text-sm text-gray-300 text-right font-medium">{settings.readerLineHeight.toFixed(1)}</span>
              </div>
            </Field>

            <Field label="Font Family">
              <select
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={settings.readerFont}
                onChange={(e) => setLocalSettings({ ...settings, readerFont: e.target.value })}
              >
                <option value="sans-serif">System Sans-Serif</option>
                <option value="serif">System Serif</option>
                <option value="monospace">Monospace</option>
                <option value="'Noto Sans JP', sans-serif">Noto Sans JP (Japanese)</option>
                <option value="'Noto Sans SC', sans-serif">Noto Sans SC (Chinese)</option>
              </select>
            </Field>

            {/* Preview */}
            <div className="border-t border-white/5 pt-6">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Preview</h4>
              <div
                className="bg-gray-800 rounded-lg p-4 border border-white/5"
                style={{
                  fontSize: `${settings.readerFontSize}px`,
                  lineHeight: settings.readerLineHeight,
                  fontFamily: settings.readerFont,
                }}
              >
                <p className="text-gray-200">The quick brown fox jumps over the lazy dog.</p>
                <p className="text-gray-200 mt-2">日本語のサンプルテキストです。</p>
                <p className="text-gray-200 mt-2">这是中文示例文本。</p>
              </div>
            </div>
          </div>
        )
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[720px] h-[580px] bg-gray-900 border border-white/10 rounded-xl shadow-2xl flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-44 bg-gray-900 border-r border-white/5 flex flex-col">
          <div className="p-4 border-b border-white/5">
            <h2 className="text-sm font-semibold text-gray-200">Settings</h2>
          </div>
          <nav className="flex-1 p-2 space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="p-3 border-t border-white/5">
            <button
              onClick={onClose}
              className="w-full px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-6">
            {renderContent()}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-6 py-3 border-t border-white/5 bg-gray-800/30">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-sm font-medium rounded-lg transition-colors bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

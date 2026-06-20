import { useEffect, useState } from 'react'
import type { AIProvider, CardTemplate, NativeLanguage, UserSettings } from '../../types'
import { COMMON_TIME_ZONES, DEFAULT_TIME_ZONE } from '../../utils/time'

interface SettingsPageProps {
  onClose: () => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
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
          onChange={(e) => { onChange(e.target.value); }}
        />
        <button
          onClick={onTest}
          disabled={status === 'testing' || !value.trim()}
          className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {status === 'testing' ? 'Testing...' : 'Test'}
        </button>
      </div>
      {status === 'ok' && <p className="mt-1 text-xs text-green-400">API key is valid</p>}
      {status === 'fail' && <p className="mt-1 text-xs text-red-400">Invalid API key — check and try again</p>}
    </Field>
  )
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [settings, setLocalSettings] = useState<UserSettings | null>(null)
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [forvoKey, setForvoKey] = useState('')
  const [learningStepsInput, setLearningStepsInput] = useState('1, 10')
  const [anthropicStatus, setAnthropicStatus] = useState<KeyStatus>('idle')
  const [openaiStatus, setOpenaiStatus] = useState<KeyStatus>('idle')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

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

  const testKey = async (key: string, provider: AIProvider, setStatus: (s: KeyStatus) => void) => {
    if (!key.trim()) return
    setStatus('testing')
    const r = await window.lexis.settings.testAIKey(key.trim(), provider)
    setStatus(r.data ? 'ok' : 'fail')
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
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[560px] max-h-[85vh] bg-gray-900 border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-gray-200">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* AI Provider */}
          <Section title="AI Provider">
            <Field label="Native Language" hint="Used for AI translations, explanations, and cached definitions. Changing it clears cached definition translations.">
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

            <Field label="Provider">
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
                    {p === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI (GPT-4o)'}
                  </button>
                ))}
              </div>
            </Field>

            <ApiKeyField
              label="Anthropic API Key"
              value={anthropicKey}
              placeholder="sk-ant-..."
              hint="Required to use Claude. Get your key at console.anthropic.com"
              status={anthropicStatus}
              onChange={(v) => { setAnthropicKey(v); setAnthropicStatus('idle') }}
              onTest={() => testKey(anthropicKey, 'anthropic', setAnthropicStatus)}
            />

            <ApiKeyField
              label="OpenAI API Key"
              value={openaiKey}
              placeholder="sk-..."
              hint="Required to use GPT-4o. Get your key at platform.openai.com"
              status={openaiStatus}
              onChange={(v) => { setOpenaiKey(v); setOpenaiStatus('idle') }}
              onTest={() => testKey(openaiKey, 'openai', setOpenaiStatus)}
            />

            {/* Active provider indicator */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
              settings.aiProvider === 'anthropic'
                ? 'bg-orange-500/10 text-orange-300 border border-orange-500/20'
                : 'bg-green-500/10 text-green-300 border border-green-500/20'
            }`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
              AI features will use{' '}
              <strong>{settings.aiProvider === 'anthropic' ? 'Claude (Anthropic)' : 'GPT-4o (OpenAI)'}</strong>
            </div>
          </Section>

          {/* Other keys */}
          <Section title="Other API Keys">
            <ApiKeyField
              label="Forvo API Key"
              value={forvoKey}
              placeholder="Your Forvo API key"
              hint="Optional. Enables real human audio pronunciations. Falls back to TTS if not set."
              status="idle"
              onChange={setForvoKey}
              onTest={() => {}}
            />
          </Section>

          {/* Reader */}
          <Section title="Scheduling">
            <Field label="Time Zone" hint="Used for due dates, learning steps, stats, and future card scheduling settings.">
              <select
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={settings.timeZone || DEFAULT_TIME_ZONE}
                onChange={(e) => setLocalSettings({ ...settings, timeZone: e.target.value })}
              >
                {timeZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Learning Steps" hint="Comma-separated minutes. Saved now; SRS wiring comes next.">
              <input
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={learningStepsInput}
                onChange={(e) => setLearningStepsInput(e.target.value)}
                onBlur={() => setScheduling({ learningStepsMinutes: parseStepInput(learningStepsInput) })}
                placeholder="1, 10"
              />
            </Field>

            <Field label="Daily Due Time" hint="Local time for future daily review cutoff behavior.">
              <input
                type="time"
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={settings.scheduling.dailyDueTime}
                onChange={(e) => setScheduling({ dailyDueTime: e.target.value })}
              />
            </Field>

            <div className="rounded-lg border border-white/10 bg-gray-800/60 px-3 py-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 accent-blue-500"
                  checked={settings.reminders.enabled}
                  onChange={(e) => setReminders({ enabled: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium text-gray-300">Smart Reminders</span>
                  <span className="block text-xs text-gray-500">
                    Lexis reminds you automatically when cards become due.
                  </span>
                </span>
              </label>
              <p className="mt-2 text-xs text-gray-600">
                If no cards are due, Lexis can still send one streak nudge after the daily due time.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
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
          </Section>

          <Section title="Cards">
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

            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-gray-800/60 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 accent-blue-500"
                checked={settings.cards.showNativeDefinitionFirst}
                onChange={(e) => setCardSettings({ showNativeDefinitionFirst: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-gray-300">Native definition first</span>
                <span className="block text-xs text-gray-500">Use Vietnamese/native definition as the primary back-side answer.</span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-gray-800/60 px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 accent-blue-500"
                checked={settings.cards.autoPlayAudio}
                onChange={(e) => setCardSettings({ autoPlayAudio: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium text-gray-300">Auto-play audio in review</span>
                <span className="block text-xs text-gray-500">Saved now; review playback wiring can use this next.</span>
              </span>
            </label>
          </Section>

          {/* Reader */}
          <Section title="Reader">
            <Field label="Font Size">
              <div className="flex items-center gap-3">
                <input type="range" min={12} max={24} step={1} className="flex-1 accent-blue-500"
                  value={settings.readerFontSize}
                  onChange={(e) => setLocalSettings({ ...settings, readerFontSize: Number(e.target.value) })}
                />
                <span className="w-8 text-xs text-gray-400 text-right">{settings.readerFontSize}px</span>
              </div>
            </Field>

            <Field label="Line Height">
              <div className="flex items-center gap-3">
                <input type="range" min={1.2} max={2.4} step={0.1} className="flex-1 accent-blue-500"
                  value={settings.readerLineHeight}
                  onChange={(e) => setLocalSettings({ ...settings, readerLineHeight: Number(e.target.value) })}
                />
                <span className="w-8 text-xs text-gray-400 text-right">{settings.readerLineHeight.toFixed(1)}</span>
              </div>
            </Field>

            <Field label="Font">
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
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
              saved ? 'bg-green-600/80 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50'
            }`}
          >
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}

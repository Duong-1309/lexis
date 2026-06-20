import Store from 'electron-store'
import type { UserSettings } from '../../src/types/index'

const DEFAULTS: UserSettings = {
  defaultDeckId: 1,
  nativeLanguage: 'vi',
  aiProvider: 'anthropic',
  anthropicApiKey: '',
  openaiApiKey: '',
  forvoApiKey: '',
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  scheduling: {
    learningStepsMinutes: [1, 10],
    dailyDueTime: '04:00',
    newCardsPerDay: 20,
    reviewsPerDay: 200,
  },
  reminders: {
    enabled: false,
    reminderTime: '20:00',
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  },
  cards: {
    defaultTemplate: 'Basic',
    showNativeDefinitionFirst: true,
    autoPlayAudio: false,
  },
  readerFontSize: 16,
  readerLineHeight: 1.6,
  readerFont: 'sans-serif',
  theme: 'dark',
  checkForUpdates: true,
  firstLaunchDone: false,
  coinBalance: 0,
}

export const settingsStore = new Store<UserSettings>({
  name: 'settings',
  defaults: DEFAULTS,
})

export function getSettings(): UserSettings {
  const stored = settingsStore.store as Partial<UserSettings>
  return {
    ...DEFAULTS,
    ...stored,
    scheduling: {
      ...DEFAULTS.scheduling,
      ...stored.scheduling,
    },
    reminders: {
      ...DEFAULTS.reminders,
      ...stored.reminders,
    },
    cards: {
      ...DEFAULTS.cards,
      ...stored.cards,
    },
  } as UserSettings
}

export function setSettings(updates: Partial<UserSettings>): void {
  Object.entries(updates).forEach(([key, value]) => {
    settingsStore.set(key as keyof UserSettings, value as UserSettings[keyof UserSettings])
  })
}

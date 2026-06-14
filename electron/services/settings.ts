import Store from 'electron-store'
import type { UserSettings } from '../../src/types/index'

const DEFAULTS: UserSettings = {
  defaultDeckId: 1,
  aiProvider: 'anthropic',
  anthropicApiKey: '',
  openaiApiKey: '',
  forvoApiKey: '',
  readerFontSize: 16,
  readerLineHeight: 1.6,
  readerFont: 'sans-serif',
  theme: 'dark',
  language: 'en',
  checkForUpdates: true,
  firstLaunchDone: false,
}

export const settingsStore = new Store<UserSettings>({
  name: 'settings',
  defaults: DEFAULTS,
})

export function getSettings(): UserSettings {
  return settingsStore.store as UserSettings
}

export function setSettings(updates: Partial<UserSettings>): void {
  Object.entries(updates).forEach(([key, value]) => {
    settingsStore.set(key as keyof UserSettings, value as UserSettings[keyof UserSettings])
  })
}

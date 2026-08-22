import { getDb } from '../connection'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'

export const ACTIVE_PUBLICATION_KEY = 'worldhubActivePublication'
export const LINKED_FOLDER_KEY = 'worldhubLinkedFolder'

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function saveSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

export function saveSettings(values: Partial<AppSettings>): void {
  const db = getDb()
  const write = db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) saveSetting(key, value)
    }
  })
  write()
}

export function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

/** The publication new scenes pin to; null in legacy (non-hub) mode. */
export function activePublicationId(): string | null {
  return getSetting(ACTIVE_PUBLICATION_KEY)
}

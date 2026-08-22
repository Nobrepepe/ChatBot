import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useTempDataDir } from './helpers'
import { getDb } from '@main/db/connection'
import { migrate } from '@main/db/migrate'
import * as worlds from '@main/db/repo/worlds'
import * as settings from '@main/db/repo/settings'
import { DEFAULT_SETTINGS } from '@shared/types'

let cleanup: () => void

beforeEach(() => {
  cleanup = useTempDataDir()
})

afterEach(() => cleanup())

describe('database schema', () => {
  it('creates every table', () => {
    const db = getDb()
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((r) => r.name)
    for (const expected of [
      'worlds',
      'locations',
      'characters',
      'character_sprites',
      'personas',
      'scenes',
      'scene_characters',
      'messages',
      'memories',
      'lore_entries',
      'lore_keyword_overrides',
      'scene_templates',
      'scene_template_characters',
      'world_notes',
      'world_notes_chat',
      'world_note_prompt_usage',
      'world_note_suggestions',
      'world_notes_workspace_sessions',
      'settings'
    ]) {
      expect(tables).toContain(expected)
    }
  })

  it('is idempotent — migrating twice is a no-op', () => {
    const db = getDb()
    const version = db.pragma('user_version', { simple: true })
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(version)
  })

  it('cascades world deletion to characters, scenes and messages', () => {
    const db = getDb()
    const worldId = worlds.saveWorld({ name: 'Eden' })
    const ts = new Date().toISOString()
    db.prepare(
      "INSERT INTO characters (world_id, name, created_at, updated_at) VALUES (?, 'Lira', ?, ?)"
    ).run(worldId, ts, ts)
    const sceneId = db
      .prepare('INSERT INTO scenes (world_id, created_at, updated_at) VALUES (?, ?, ?)')
      .run(worldId, ts, ts).lastInsertRowid
    db.prepare(
      "INSERT INTO messages (scene_id, role, content, created_at) VALUES (?, 'user', 'hi', ?)"
    ).run(sceneId, ts)

    worlds.deleteWorld(worldId)
    expect(db.prepare('SELECT COUNT(*) c FROM characters').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM scenes').get()).toEqual({ c: 0 })
    expect(db.prepare('SELECT COUNT(*) c FROM messages').get()).toEqual({ c: 0 })
  })
})

describe('worlds repository', () => {
  it('round-trips a world', () => {
    const id = worlds.saveWorld({ name: 'Eden', genre: 'fantasy', settingDescription: 'A vale.' })
    const world = worlds.getWorld(id)
    expect(world?.name).toBe('Eden')
    expect(world?.genre).toBe('fantasy')
    expect(world?.settingDescription).toBe('A vale.')
    expect(worlds.listWorlds().map((w) => w.id)).toEqual([id])

    worlds.saveWorld({ id, name: 'Eden Castle' })
    expect(worlds.getWorld(id)?.name).toBe('Eden Castle')
  })

  it('refuses to edit or delete hub-managed worlds', () => {
    const id = worlds.saveWorld({ name: 'Hubworld' })
    getDb().prepare("UPDATE worlds SET hub_id = 'w1', publication_id = 'p1' WHERE id = ?").run(id)
    expect(() => worlds.saveWorld({ id, name: 'Renamed' })).toThrow(/read-only/)
    expect(() => worlds.deleteWorld(id)).toThrow(/read-only/)
  })

  it('filters worlds to the active publication in hub mode', () => {
    const localId = worlds.saveWorld({ name: 'Local' })
    const db = getDb()
    const ts = new Date().toISOString()
    db.prepare(
      `INSERT INTO worlds (name, hub_id, publication_id, created_at, updated_at)
       VALUES ('HubV1', 'w1', 'pub1', ?, ?), ('HubV2', 'w1', 'pub2', ?, ?)`
    ).run(ts, ts, ts, ts)

    settings.saveSetting(settings.ACTIVE_PUBLICATION_KEY, 'pub2')
    const names = worlds.listWorlds().map((w) => w.name)
    expect(names).toContain('HubV2')
    expect(names).toContain('Local')
    expect(names).not.toContain('HubV1')
    expect(worlds.listWorlds().find((w) => w.name === 'Local')?.id).toBe(localId)
  })
})

describe('settings repository', () => {
  it('returns defaults when nothing is stored', () => {
    expect(settings.getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists partial saves over defaults', () => {
    settings.saveSettings({ baseUrl: 'http://localhost:8111/v1', temperature: '0.5' })
    const s = settings.getSettings()
    expect(s.baseUrl).toBe('http://localhost:8111/v1')
    expect(s.temperature).toBe('0.5')
    expect(s.topP).toBe(DEFAULT_SETTINGS.topP)
  })
})

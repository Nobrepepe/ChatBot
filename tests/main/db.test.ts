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
      'memory_suggestions',
      'settings'
    ]) {
      expect(tables).toContain(expected)
    }
  })

  it('carries a version 1 database forward without losing what it held', async () => {
    const { default: Database } = await import('better-sqlite3')
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const init = readFileSync(
      fileURLToPath(new URL('../../src/main/db/migrations/001_init.sql', import.meta.url)),
      'utf8'
    )
    const db = new Database(':memory:')
    db.exec(init)
    db.pragma('user_version = 1')

    const ts = '2026-01-01T00:00:00.000Z'
    db.prepare("INSERT INTO worlds (name, created_at, updated_at) VALUES ('Eden', ?, ?)").run(ts, ts)
    db.prepare(
      "INSERT INTO characters (world_id, name, created_at, updated_at) VALUES (1, 'Lirael', ?, ?)"
    ).run(ts, ts)
    db.prepare(
      `INSERT INTO scenes (world_id, title, premise, tone, time_of_day, relationship_status,
       created_at, updated_at) VALUES (1, ?, ?, 'Tense', 'Night', 'Wary', ?, ?)`
    ).run('The rooftop', 'A storm traps everyone inside.', ts, ts)
    db.prepare(
      `INSERT INTO scenes (world_id, title, premise, created_at, updated_at)
       VALUES (1, '', 'Untitled but written.', ?, ?)`
    ).run(ts, ts)
    db.prepare(
      `INSERT INTO memories (character_id, type, content, status, created_at)
       VALUES (1, 'canon', 'Lirael cannot swim.', 'approved', ?),
              (1, 'canon', 'Lirael is afraid of the water.', 'pending', ?)`
    ).run(ts, ts)

    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(4)

    // A premise that was not already the title survives as the opening context.
    const scenes = db.prepare('SELECT title, previously_on FROM scenes ORDER BY id').all() as {
      title: string
      previously_on: string
    }[]
    expect(scenes[0]).toEqual({
      title: 'The rooftop',
      previously_on: 'A storm traps everyone inside.'
    })
    // A scene with no title of its own is named by its premise instead.
    expect(scenes[1]!.title).toBe('Untitled but written.')

    const memories = db
      .prepare('SELECT content, lifecycle_status FROM memories ORDER BY id')
      .all() as { content: string; lifecycle_status: string }[]
    expect(memories.map((m) => m.lifecycle_status)).toEqual(['canonical', 'proposed'])

    // Nothing that was waiting for review is stranded outside the new flow.
    const proposals = db
      .prepare('SELECT action_type, target_memory_id, status FROM memory_suggestions')
      .all() as { action_type: string; target_memory_id: number; status: string }[]
    expect(proposals).toEqual([{ action_type: 'create', target_memory_id: 2, status: 'pending' }])

    db.close()
  })

  it('collapses the duplicate rows a version 2 database accumulated, keeping what hung off them', async () => {
    const { default: Database } = await import('better-sqlite3')
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const read = (name: string): string =>
      readFileSync(
        fileURLToPath(new URL(`../../src/main/db/migrations/${name}`, import.meta.url)),
        'utf8'
      )

    const db = new Database(':memory:')
    db.exec(read('001_init.sql'))
    db.exec(read('002_scenes_and_memory_proposals.sql'))
    db.pragma('user_version = 2')

    // What version 2 left behind: one entity, one row per publication, and the
    // conversation attached to the copy the older publication imported.
    const ts = '2026-01-01T00:00:00.000Z'
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('worldhubActivePublication', 'pub2')"
    ).run()
    db.prepare(
      `INSERT INTO worlds (name, hub_id, publication_id, created_at, updated_at)
       VALUES ('Emberfall', 'w1', 'pub1', ?, ?), ('Emberfall Reborn', 'w1', 'pub2', ?, ?)`
    ).run(ts, ts, ts, ts)
    db.prepare(
      `INSERT INTO characters (world_id, name, hub_id, publication_id, created_at, updated_at)
       VALUES (1, 'Ash', 'c1', 'pub1', ?, ?), (2, 'Ashley', 'c1', 'pub2', ?, ?)`
    ).run(ts, ts, ts, ts)
    db.prepare(
      "INSERT INTO scenes (world_id, title, publication_id, created_at, updated_at) VALUES (1, 'Stranded', 'pub1', ?, ?)"
    ).run(ts, ts)
    db.prepare(
      'INSERT INTO scene_characters (scene_id, character_id, sort_order) VALUES (1, 1, 0)'
    ).run()
    db.prepare(
      "INSERT INTO messages (scene_id, role, character_id, content, created_at) VALUES (1, 'character', 1, 'Hello.', ?)"
    ).run(ts)
    db.prepare(
      "INSERT INTO memories (character_id, type, content, created_at) VALUES (1, 'canon', 'Ash cannot swim.', ?)"
    ).run(ts)
    db.prepare(
      "INSERT INTO world_notes (world_id, title, created_at, updated_at) VALUES (1, 'Private', ?, ?)"
    ).run(ts, ts)

    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(4)

    // One row per entity, holding the active publication's content.
    const world = db.prepare("SELECT * FROM worlds WHERE hub_id = 'w1'").all() as any[]
    expect(world).toHaveLength(1)
    expect(world[0].name).toBe('Emberfall Reborn')
    expect(world[0].publication_id).toBe('pub2')
    expect(world[0].retired_at).toBeNull()
    const character = db.prepare("SELECT * FROM characters WHERE hub_id = 'c1'").all() as any[]
    expect(character).toHaveLength(1)
    expect(character[0].name).toBe('Ashley')

    // And everything that pointed at the older copy now points at that row.
    const scene = db.prepare('SELECT world_id FROM scenes WHERE id = 1').get() as {
      world_id: number
    }
    expect(scene.world_id).toBe(world[0].id)
    expect(
      (
        db.prepare('SELECT character_id FROM scene_characters WHERE scene_id = 1').all() as any[]
      ).map((r) => r.character_id)
    ).toEqual([character[0].id])
    expect((db.prepare('SELECT character_id FROM messages').get() as any).character_id).toBe(
      character[0].id
    )
    expect((db.prepare('SELECT character_id FROM memories').get() as any).character_id).toBe(
      character[0].id
    )
    expect((db.prepare('SELECT world_id FROM world_notes').get() as any).world_id).toBe(world[0].id)

    db.close()
  })

  it('makes room for extras without disturbing the turns already written', async () => {
    const { default: Database } = await import('better-sqlite3')
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const read = (name: string): string =>
      readFileSync(
        fileURLToPath(new URL(`../../src/main/db/migrations/${name}`, import.meta.url)),
        'utf8'
      )

    const db = new Database(':memory:')
    db.exec(read('001_init.sql'))
    db.exec(read('002_scenes_and_memory_proposals.sql'))
    db.exec(read('003_hub_entity_identity.sql'))
    db.pragma('user_version = 3')

    const ts = '2026-01-01T00:00:00.000Z'
    db.prepare("INSERT INTO worlds (name, created_at, updated_at) VALUES ('Eden', ?, ?)").run(ts, ts)
    db.prepare(
      "INSERT INTO characters (world_id, name, created_at, updated_at) VALUES (1, 'Lirael', ?, ?)"
    ).run(ts, ts)
    db.prepare(
      "INSERT INTO scenes (world_id, title, created_at, updated_at) VALUES (1, 'The rooftop', ?, ?)"
    ).run(ts, ts)
    db.prepare(
      `INSERT INTO messages (scene_id, role, character_id, content, emotion, created_at)
       VALUES (1, 'user', NULL, 'Hello?', '', ?), (1, 'character', 1, 'Hello.', 'sad', ?)`
    ).run(ts, ts)

    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(4)

    // The table was rebuilt, so what it held has to come through untouched —
    // ids included, because the scene's turns are ordered by them.
    const rows = db.prepare('SELECT * FROM messages ORDER BY id').all() as any[]
    expect(rows.map((r) => [r.id, r.role, r.character_id, r.content, r.emotion])).toEqual([
      [1, 'user', null, 'Hello?', ''],
      [2, 'character', 1, 'Hello.', 'sad']
    ])
    expect(rows.every((r) => r.speaker_name === '')).toBe(true)

    // And the new role is admitted, with a name of its own.
    db.prepare(
      `INSERT INTO messages (scene_id, role, speaker_name, content, created_at)
       VALUES (1, 'extra', 'Taxi driver', '"Where to?"', ?)`
    ).run(ts)
    expect(
      (db.prepare("SELECT speaker_name FROM messages WHERE role = 'extra'").get() as any)
        .speaker_name
    ).toBe('Taxi driver')

    // The scene still cascades through the rebuilt table.
    db.pragma('foreign_keys = ON')
    db.prepare('DELETE FROM worlds').run()
    expect(db.prepare('SELECT COUNT(*) c FROM messages').get()).toEqual({ c: 0 })

    db.close()
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

  it('lists the current canon, and keeps a retired world only while it holds a scene', () => {
    const localId = worlds.saveWorld({ name: 'Local' })
    const db = getDb()
    const ts = new Date().toISOString()
    db.prepare(
      `INSERT INTO worlds (name, hub_id, publication_id, retired_at, created_at, updated_at)
       VALUES ('Current', 'w1', 'pub2', NULL, ?, ?),
              ('Played in', 'w2', 'pub1', ?, ?, ?),
              ('Never played in', 'w3', 'pub1', ?, ?, ?)`
    ).run(ts, ts, ts, ts, ts, ts, ts, ts)
    const playedIn = db.prepare("SELECT id FROM worlds WHERE hub_id = 'w2'").get() as { id: number }
    db.prepare(
      `INSERT INTO scenes (world_id, title, created_at, updated_at) VALUES (?, 'A scene', ?, ?)`
    ).run(playedIn.id, ts, ts)

    const names = worlds.listWorlds().map((w) => w.name)
    expect(names).toContain('Current')
    expect(names).toContain('Local')
    // Retired, but a conversation still lives there — so it stays reachable, last.
    expect(names).toContain('Played in')
    expect(names.indexOf('Played in')).toBe(names.length - 1)
    expect(names).not.toContain('Never played in')
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

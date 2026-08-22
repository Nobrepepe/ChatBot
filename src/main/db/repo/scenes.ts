import { getDb } from '../connection'
import type { DisplayMode, Scene, SceneDraft, SceneMode } from '@shared/types'
import { activePublicationId } from './settings'
import { now, toBool } from './util'

interface SceneRow {
  id: number
  world_id: number
  location_id: number | null
  title: string
  premise: string
  tone: string
  time_of_day: string
  relationship_status: string
  mode: string
  summary: string
  narrator_enabled: number
  persona_id: number | null
  publication_id: string | null
  display_mode: string | null
  created_at: string
  updated_at: string
}

function characterIds(sceneId: number): number[] {
  return (
    getDb()
      .prepare('SELECT character_id FROM scene_characters WHERE scene_id = ? ORDER BY sort_order, character_id')
      .all(sceneId) as { character_id: number }[]
  ).map((r) => r.character_id)
}

function mapScene(r: SceneRow): Scene {
  return {
    id: r.id,
    worldId: r.world_id,
    locationId: r.location_id,
    title: r.title,
    premise: r.premise,
    tone: r.tone,
    timeOfDay: r.time_of_day,
    relationshipStatus: r.relationship_status,
    mode: r.mode as SceneMode,
    summary: r.summary,
    narratorEnabled: toBool(r.narrator_enabled),
    personaId: r.persona_id,
    publicationId: r.publication_id,
    displayMode: (r.display_mode as DisplayMode | null) ?? null,
    characterIds: characterIds(r.id),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listScenes(worldId: number): Scene[] {
  const rows = getDb()
    .prepare('SELECT * FROM scenes WHERE world_id = ? ORDER BY updated_at DESC, id DESC')
    .all(worldId) as SceneRow[]
  return rows.map(mapScene)
}

export function listAllScenes(): Scene[] {
  const rows = getDb()
    .prepare('SELECT * FROM scenes ORDER BY updated_at DESC, id DESC')
    .all() as SceneRow[]
  return rows.map(mapScene)
}

export function getScene(id: number): Scene | null {
  const row = getDb().prepare('SELECT * FROM scenes WHERE id = ?').get(id) as SceneRow | undefined
  return row ? mapScene(row) : null
}

export function saveScene(draft: SceneDraft): number {
  const db = getDb()
  const ts = now()
  const write = db.transaction((): number => {
    let id: number
    if (draft.id) {
      db.prepare(
        `UPDATE scenes SET title = ?, premise = ?, tone = ?, time_of_day = ?,
         relationship_status = ?, mode = ?, narrator_enabled = ?, persona_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        draft.title ?? '',
        draft.premise ?? '',
        draft.tone ?? '',
        draft.timeOfDay ?? '',
        draft.relationshipStatus ?? '',
        draft.mode ?? 'roleplay',
        draft.narratorEnabled ? 1 : 0,
        draft.personaId ?? null,
        ts,
        draft.id
      )
      id = draft.id
    } else {
      // New scenes pin to the publication that is active when they begin.
      const info = db
        .prepare(
          `INSERT INTO scenes (world_id, title, premise, tone, time_of_day, relationship_status,
           mode, narrator_enabled, persona_id, publication_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          draft.worldId,
          draft.title ?? '',
          draft.premise ?? '',
          draft.tone ?? '',
          draft.timeOfDay ?? '',
          draft.relationshipStatus ?? '',
          draft.mode ?? 'roleplay',
          draft.narratorEnabled ? 1 : 0,
          draft.personaId ?? null,
          activePublicationId(),
          ts,
          ts
        )
      id = Number(info.lastInsertRowid)
    }
    db.prepare('DELETE FROM scene_characters WHERE scene_id = ?').run(id)
    const insert = db.prepare(
      'INSERT INTO scene_characters (scene_id, character_id, sort_order) VALUES (?, ?, ?)'
    )
    ;(draft.characterIds ?? []).forEach((cid, index) => insert.run(id, cid, index))
    return id
  })
  return write()
}

export function touchScene(id: number): void {
  getDb().prepare('UPDATE scenes SET updated_at = ? WHERE id = ?').run(now(), id)
}

export function setSceneSummary(id: number, summary: string): void {
  getDb().prepare('UPDATE scenes SET summary = ?, updated_at = ? WHERE id = ?').run(summary, now(), id)
}

export function setSceneDisplayMode(id: number, mode: DisplayMode | null): void {
  getDb().prepare('UPDATE scenes SET display_mode = ? WHERE id = ?').run(mode, id)
}

export function deleteScene(id: number): void {
  getDb().prepare('DELETE FROM scenes WHERE id = ?').run(id)
}

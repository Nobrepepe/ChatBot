import { getDb } from '../connection'
import type { World, WorldDraft } from '@shared/types'
import { activePublicationId } from './settings'
import { assertNotHubManaged, now } from './util'

interface WorldRow {
  id: number
  name: string
  genre: string
  tone: string
  summary: string
  setting_description: string
  style_guide: string
  cover_image_path: string
  session_background_path: string
  hub_id: string | null
  publication_id: string | null
  created_at: string
  updated_at: string
}

function mapWorld(r: WorldRow): World {
  return {
    id: r.id,
    name: r.name,
    genre: r.genre,
    tone: r.tone,
    summary: r.summary,
    settingDescription: r.setting_description,
    styleGuide: r.style_guide,
    coverImagePath: r.cover_image_path,
    sessionBackgroundPath: r.session_background_path,
    hubId: r.hub_id,
    publicationId: r.publication_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

/**
 * Canonical worlds: local rows in legacy mode, the active publication's rows in
 * Hub mode. Pinned scenes resolve their world by id, so older rows stay reachable.
 */
export function listWorlds(): World[] {
  const active = activePublicationId()
  const rows = active
    ? (getDb()
        .prepare(
          'SELECT * FROM worlds WHERE publication_id = ? OR publication_id IS NULL ORDER BY name'
        )
        .all(active) as WorldRow[])
    : (getDb()
        .prepare('SELECT * FROM worlds WHERE publication_id IS NULL ORDER BY name')
        .all() as WorldRow[])
  return rows.map(mapWorld)
}

export function getWorld(id: number): World | null {
  const row = getDb().prepare('SELECT * FROM worlds WHERE id = ?').get(id) as WorldRow | undefined
  return row ? mapWorld(row) : null
}

export function saveWorld(draft: WorldDraft): number {
  const db = getDb()
  const ts = now()
  if (draft.id) {
    const existing = db.prepare('SELECT hub_id FROM worlds WHERE id = ?').get(draft.id) as
      | { hub_id: string | null }
      | undefined
    assertNotHubManaged(existing, 'world')
    db.prepare(
      `UPDATE worlds SET name = ?, genre = ?, tone = ?, summary = ?, setting_description = ?,
       style_guide = ?, cover_image_path = ?, session_background_path = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      draft.name,
      draft.genre ?? '',
      draft.tone ?? '',
      draft.summary ?? '',
      draft.settingDescription ?? '',
      draft.styleGuide ?? '',
      draft.coverImagePath ?? '',
      draft.sessionBackgroundPath ?? '',
      ts,
      draft.id
    )
    return draft.id
  }
  const info = db
    .prepare(
      `INSERT INTO worlds (name, genre, tone, summary, setting_description, style_guide,
       cover_image_path, session_background_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      draft.name,
      draft.genre ?? '',
      draft.tone ?? '',
      draft.summary ?? '',
      draft.settingDescription ?? '',
      draft.styleGuide ?? '',
      draft.coverImagePath ?? '',
      draft.sessionBackgroundPath ?? '',
      ts,
      ts
    )
  return Number(info.lastInsertRowid)
}

export function deleteWorld(id: number): void {
  const db = getDb()
  const existing = db.prepare('SELECT hub_id FROM worlds WHERE id = ?').get(id) as
    | { hub_id: string | null }
    | undefined
  assertNotHubManaged(existing, 'world')
  db.prepare('DELETE FROM worlds WHERE id = ?').run(id)
}

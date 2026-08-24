import { getDb } from '../connection'
import type { SceneMode, SceneTemplate, SceneTemplateDraft } from '@shared/types'
import { toBool } from './util'

interface TemplateRow {
  id: number
  world_id: number
  name: string
  title: string
  previously_on: string
  mode: string
  narrator_enabled: number
  location_id: number | null
  persona_id: number | null
}

function mapTemplate(r: TemplateRow): SceneTemplate {
  const ids = (
    getDb()
      .prepare(
        'SELECT character_id FROM scene_template_characters WHERE template_id = ? ORDER BY sort_order, character_id'
      )
      .all(r.id) as { character_id: number }[]
  ).map((row) => row.character_id)
  return {
    id: r.id,
    worldId: r.world_id,
    name: r.name,
    title: r.title,
    previouslyOn: r.previously_on,
    mode: r.mode as SceneMode,
    narratorEnabled: toBool(r.narrator_enabled),
    locationId: r.location_id,
    personaId: r.persona_id,
    characterIds: ids
  }
}

export function listSceneTemplates(worldId: number): SceneTemplate[] {
  const rows = getDb()
    .prepare('SELECT * FROM scene_templates WHERE world_id = ? ORDER BY name, id')
    .all(worldId) as TemplateRow[]
  return rows.map(mapTemplate)
}

export function getSceneTemplate(id: number): SceneTemplate | null {
  const row = getDb().prepare('SELECT * FROM scene_templates WHERE id = ?').get(id) as
    | TemplateRow
    | undefined
  return row ? mapTemplate(row) : null
}

export function saveSceneTemplate(draft: SceneTemplateDraft): number {
  const db = getDb()
  const write = db.transaction((): number => {
    let id: number
    if (draft.id) {
      db.prepare(
        `UPDATE scene_templates SET name = ?, title = ?, previously_on = ?, mode = ?,
         narrator_enabled = ?, location_id = ?, persona_id = ?
         WHERE id = ?`
      ).run(
        draft.name,
        draft.title ?? '',
        draft.previouslyOn ?? '',
        draft.mode ?? 'roleplay',
        draft.narratorEnabled ? 1 : 0,
        draft.locationId ?? null,
        draft.personaId ?? null,
        draft.id
      )
      id = draft.id
    } else {
      const info = db
        .prepare(
          `INSERT INTO scene_templates (world_id, name, title, previously_on,
           mode, narrator_enabled, location_id, persona_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          draft.worldId,
          draft.name,
          draft.title ?? '',
          draft.previouslyOn ?? '',
          draft.mode ?? 'roleplay',
          draft.narratorEnabled ? 1 : 0,
          draft.locationId ?? null,
          draft.personaId ?? null
        )
      id = Number(info.lastInsertRowid)
    }
    db.prepare('DELETE FROM scene_template_characters WHERE template_id = ?').run(id)
    const insert = db.prepare(
      'INSERT INTO scene_template_characters (template_id, character_id, sort_order) VALUES (?, ?, ?)'
    )
    ;(draft.characterIds ?? []).forEach((cid, index) => insert.run(id, cid, index))
    return id
  })
  return write()
}

export function deleteSceneTemplate(id: number): void {
  getDb().prepare('DELETE FROM scene_templates WHERE id = ?').run(id)
}

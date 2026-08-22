import { getDb } from '../connection'
import type { Persona, PersonaDraft } from '@shared/types'
import { now } from './util'

interface PersonaRow {
  id: number
  name: string
  description: string
  created_at: string
}

function mapPersona(r: PersonaRow): Persona {
  return { id: r.id, name: r.name, description: r.description, createdAt: r.created_at }
}

export function listPersonas(): Persona[] {
  const rows = getDb().prepare('SELECT * FROM personas ORDER BY name').all() as PersonaRow[]
  return rows.map(mapPersona)
}

export function getPersona(id: number): Persona | null {
  const row = getDb().prepare('SELECT * FROM personas WHERE id = ?').get(id) as
    | PersonaRow
    | undefined
  return row ? mapPersona(row) : null
}

export function savePersona(draft: PersonaDraft): number {
  const db = getDb()
  if (draft.id) {
    db.prepare('UPDATE personas SET name = ?, description = ? WHERE id = ?').run(
      draft.name,
      draft.description ?? '',
      draft.id
    )
    return draft.id
  }
  const info = db
    .prepare('INSERT INTO personas (name, description, created_at) VALUES (?, ?, ?)')
    .run(draft.name, draft.description ?? '', now())
  return Number(info.lastInsertRowid)
}

export function deletePersona(id: number): void {
  getDb().prepare('DELETE FROM personas WHERE id = ?').run(id)
}

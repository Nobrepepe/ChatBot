import { getDb } from '../connection'
import type { Memory, MemoryDraft, MemoryStatus, MemoryType } from '@shared/types'
import { now } from './util'

interface MemoryRow {
  id: number
  character_id: number
  type: string
  content: string
  source_scene_id: number | null
  status: string
  created_at: string
}

function mapMemory(r: MemoryRow): Memory {
  return {
    id: r.id,
    characterId: r.character_id,
    type: r.type as MemoryType,
    content: r.content,
    sourceSceneId: r.source_scene_id,
    status: r.status as MemoryStatus,
    createdAt: r.created_at
  }
}

export function listMemories(
  characterId: number,
  options: { types?: MemoryType[]; status?: MemoryStatus | 'any' } = {}
): Memory[] {
  const status = options.status ?? 'approved'
  const clauses = ['character_id = ?']
  const params: unknown[] = [characterId]
  if (status !== 'any') {
    clauses.push('status = ?')
    params.push(status)
  }
  if (options.types?.length) {
    clauses.push(`type IN (${options.types.map(() => '?').join(', ')})`)
    params.push(...options.types)
  }
  const rows = getDb()
    .prepare(`SELECT * FROM memories WHERE ${clauses.join(' AND ')} ORDER BY id`)
    .all(...params) as MemoryRow[]
  return rows.map(mapMemory)
}

export function saveMemory(draft: MemoryDraft): number {
  const db = getDb()
  if (draft.id) {
    db.prepare('UPDATE memories SET type = ?, content = ?, status = ? WHERE id = ?').run(
      draft.type,
      draft.content,
      draft.status ?? 'approved',
      draft.id
    )
    return draft.id
  }
  const info = db
    .prepare(
      `INSERT INTO memories (character_id, type, content, source_scene_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      draft.characterId,
      draft.type,
      draft.content,
      draft.sourceSceneId ?? null,
      draft.status ?? 'approved',
      now()
    )
  return Number(info.lastInsertRowid)
}

export function deleteMemory(id: number): void {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
}

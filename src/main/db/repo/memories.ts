import { getDb } from '../connection'
import {
  LIFECYCLE_STATUSES,
  MEMORY_TYPES,
  type Memory,
  type MemoryActionType,
  type MemoryDraft,
  type MemoryLifecycleStatus,
  type MemoryProposal,
  type MemorySuggestion,
  type MemoryType,
  type SuggestionStatus
} from '@shared/types'
import { now } from './util'

interface MemoryRow {
  id: number
  character_id: number
  type: string
  content: string
  source_scene_id: number | null
  lifecycle_status: string
  created_at: string
}

function mapMemory(r: MemoryRow): Memory {
  return {
    id: r.id,
    characterId: r.character_id,
    type: r.type as MemoryType,
    content: r.content,
    sourceSceneId: r.source_scene_id,
    lifecycleStatus: r.lifecycle_status as MemoryLifecycleStatus,
    createdAt: r.created_at
  }
}

function validLifecycle(value: string | undefined): MemoryLifecycleStatus {
  return value && (LIFECYCLE_STATUSES as readonly string[]).includes(value)
    ? (value as MemoryLifecycleStatus)
    : 'canonical'
}

function validType(value: unknown, fallback: MemoryType = 'canon'): MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(String(value))
    ? (String(value) as MemoryType)
    : fallback
}

/** Canonical memories only, unless another lifecycle (or 'any') is asked for. */
export function listMemories(
  characterId: number,
  options: { types?: MemoryType[]; lifecycle?: MemoryLifecycleStatus | 'any' } = {}
): Memory[] {
  const lifecycle = options.lifecycle ?? 'canonical'
  const clauses = ['character_id = ?']
  const params: unknown[] = [characterId]
  if (lifecycle !== 'any') {
    clauses.push('lifecycle_status = ?')
    params.push(lifecycle)
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

export function getMemory(id: number): Memory | null {
  const row = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined
  return row ? mapMemory(row) : null
}

export function saveMemory(draft: MemoryDraft): number {
  const db = getDb()
  if (draft.id) {
    db.prepare('UPDATE memories SET type = ?, content = ?, lifecycle_status = ? WHERE id = ?').run(
      draft.type,
      draft.content,
      validLifecycle(draft.lifecycleStatus),
      draft.id
    )
    return draft.id
  }
  const info = db
    .prepare(
      `INSERT INTO memories (character_id, type, content, source_scene_id, lifecycle_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      draft.characterId,
      draft.type,
      draft.content,
      draft.sourceSceneId ?? null,
      validLifecycle(draft.lifecycleStatus),
      now()
    )
  return Number(info.lastInsertRowid)
}

export function deleteMemory(id: number): void {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
}

// ------------------------------------------------- proposals (AI suggestions)

interface SuggestionRow {
  id: number
  scene_id: number | null
  character_id: number
  action_type: string
  target_memory_id: number | null
  payload_json: string
  status: string
  created_at: string
}

function mapSuggestion(r: SuggestionRow): MemorySuggestion {
  return {
    id: r.id,
    sceneId: r.scene_id,
    characterId: r.character_id,
    actionType: r.action_type as MemoryActionType,
    targetMemoryId: r.target_memory_id,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    status: r.status as SuggestionStatus,
    createdAt: r.created_at
  }
}

export interface NewMemorySuggestion {
  sceneId: number | null
  characterId: number
  actionType: MemoryActionType
  /** Required for replace and forget; a create allocates its own. */
  targetMemoryId: number | null
  payload: Record<string, unknown>
}

/**
 * Persists one proposed action. A create allocates a real memory row up front,
 * marked 'proposed', so the model can revise the same stable id on a later
 * pass instead of proposing a second fact beside it. An earlier unresolved
 * proposal against the same memory is superseded — the newest reading wins.
 */
export function saveMemorySuggestion(input: NewMemorySuggestion): number {
  const db = getDb()
  const run = db.transaction((): number => {
    const ts = now()
    let target = input.targetMemoryId
    const payload = { ...input.payload }

    if (input.actionType === 'create') {
      target = Number(
        db
          .prepare(
            `INSERT INTO memories (character_id, type, content, source_scene_id, lifecycle_status, created_at)
             VALUES (?, ?, ?, ?, 'proposed', ?)`
          )
          .run(
            input.characterId,
            validType(payload['memory_type']),
            String(payload['content'] ?? ''),
            input.sceneId,
            ts
          ).lastInsertRowid
      )
      payload['memory_id'] = target
    } else {
      const row = db.prepare('SELECT character_id FROM memories WHERE id = ?').get(target) as
        | { character_id: number }
        | undefined
      if (!row) throw new Error('Proposal target memory not found')
    }

    if (target !== null) {
      const prior = db
        .prepare("SELECT id FROM memory_suggestions WHERE target_memory_id = ? AND status = 'pending'")
        .all(target) as { id: number }[]
      for (const p of prior) {
        db.prepare("UPDATE memory_suggestions SET status = 'superseded' WHERE id = ?").run(p.id)
      }
    }

    const info = db
      .prepare(
        `INSERT INTO memory_suggestions (scene_id, character_id, action_type, target_memory_id,
         payload_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`
      )
      .run(
        input.sceneId,
        input.characterId,
        input.actionType,
        target,
        JSON.stringify(payload),
        ts
      )
    return Number(info.lastInsertRowid)
  })
  return run()
}

export function getMemorySuggestion(id: number): MemorySuggestion | null {
  const row = getDb().prepare('SELECT * FROM memory_suggestions WHERE id = ?').get(id) as
    | SuggestionRow
    | undefined
  return row ? mapSuggestion(row) : null
}

type ProposalRow = SuggestionRow & {
  character_name: string | null
  memory_content: string | null
  memory_type: string | null
  memory_lifecycle: string | null
}

function mapProposal(r: ProposalRow): MemoryProposal {
  const suggestion = mapSuggestion(r)
  const stored = r.memory_content ?? ''
  const proposed =
    suggestion.actionType === 'forget' ? '' : String(suggestion.payload['content'] ?? stored)
  return {
    ...suggestion,
    characterName: r.character_name ?? '',
    lifecycleStatus: (r.memory_lifecycle as MemoryLifecycleStatus | null) ?? null,
    currentContent: suggestion.actionType === 'create' ? '' : stored,
    proposedContent: proposed,
    memoryType: validType(suggestion.payload['memory_type'], validType(r.memory_type))
  }
}

function proposals(where: string, params: unknown[]): MemoryProposal[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*, c.name AS character_name, m.content AS memory_content,
              m.type AS memory_type, m.lifecycle_status AS memory_lifecycle
       FROM memory_suggestions s
       LEFT JOIN characters c ON c.id = s.character_id
       LEFT JOIN memories m ON m.id = s.target_memory_id
       WHERE ${where}
       ORDER BY s.id`
    )
    .all(...params) as ProposalRow[]
  return rows.map(mapProposal)
}

export function listSceneProposals(sceneId: number, statuses: SuggestionStatus[] = ['pending']): MemoryProposal[] {
  return proposals(
    `s.scene_id = ? AND s.status IN (${statuses.map(() => '?').join(', ')})`,
    [sceneId, ...statuses]
  )
}

export function listCharacterProposals(
  characterId: number,
  statuses: SuggestionStatus[] = ['pending']
): MemoryProposal[] {
  return proposals(
    `s.character_id = ? AND s.status IN (${statuses.map(() => '?').join(', ')})`,
    [characterId, ...statuses]
  )
}

/**
 * The ledger handed back to the model: every unresolved proposal for this
 * scene's cast, so a second pass revises what it already proposed instead of
 * proposing it again.
 */
export function listCastProposalLedger(characterIds: number[]): MemoryProposal[] {
  if (!characterIds.length) return []
  const ids = characterIds.map(() => '?').join(', ')
  return proposals(
    `s.character_id IN (${ids}) AND s.status IN ('pending', 'rejected')`,
    [...characterIds]
  )
}

/** The stable memory ids the model may reference: canonical or still proposed. */
export function listProposableMemoryIds(characterIds: number[]): Set<number> {
  if (!characterIds.length) return new Set()
  const rows = getDb()
    .prepare(
      `SELECT id FROM memories
       WHERE character_id IN (${characterIds.map(() => '?').join(', ')})
       AND lifecycle_status IN ('canonical', 'proposed', 'rejected')`
    )
    .all(...characterIds) as { id: number }[]
  return new Set(rows.map((r) => r.id))
}

export function setMemorySuggestionStatus(id: number, status: SuggestionStatus): void {
  const db = getDb()
  const run = db.transaction(() => {
    const suggestion = db
      .prepare('SELECT target_memory_id FROM memory_suggestions WHERE id = ?')
      .get(id) as { target_memory_id: number | null } | undefined
    db.prepare('UPDATE memory_suggestions SET status = ? WHERE id = ?').run(status, id)
    if (suggestion?.target_memory_id != null && (status === 'rejected' || status === 'superseded')) {
      db.prepare(
        "UPDATE memories SET lifecycle_status = ? WHERE id = ? AND lifecycle_status != 'canonical'"
      ).run(status, suggestion.target_memory_id)
    }
  })
  run()
}

/**
 * Approve with the user's edits. Create and replace write the text and make the
 * row canonical; forget removes the memory outright. Returns the memory id, or
 * 0 when the memory is gone.
 */
export function approveMemorySuggestion(id: number, content: string, type: MemoryType): number {
  const db = getDb()
  const run = db.transaction((): number => {
    const suggestion = db.prepare('SELECT * FROM memory_suggestions WHERE id = ?').get(id) as
      | SuggestionRow
      | undefined
    if (!suggestion) throw new Error('The proposal no longer exists.')
    const target = suggestion.target_memory_id
    if (target == null) throw new Error('The proposal no longer has a memory.')

    if (suggestion.action_type === 'forget') {
      db.prepare('DELETE FROM memories WHERE id = ?').run(target)
      db.prepare("UPDATE memory_suggestions SET status = 'approved' WHERE id = ?").run(id)
      return 0
    }
    const changed = db
      .prepare(
        "UPDATE memories SET content = ?, type = ?, lifecycle_status = 'canonical' WHERE id = ?"
      )
      .run(content, validType(type), target)
    if (changed.changes === 0) throw new Error('The memory this proposal edits no longer exists.')
    db.prepare("UPDATE memory_suggestions SET status = 'approved' WHERE id = ?").run(id)
    return target
  })
  return run()
}

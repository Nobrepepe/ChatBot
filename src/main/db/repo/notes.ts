import { getDb } from '../connection'
import {
  NOTE_CATEGORIES,
  NOTE_CONTEXT_MODES,
  NOTE_LIFECYCLE_STATUSES,
  type NoteActionType,
  type NoteCategory,
  type NoteChatMessage,
  type NoteContextMode,
  type NoteLifecycleStatus,
  type NoteSuggestion,
  type SuggestionStatus,
  type WorldNote,
  type WorldNoteDraft
} from '@shared/types'
import { now, toBool } from './util'

interface NoteRow {
  id: number
  world_id: number
  title: string
  content: string
  category: string
  is_pinned: number
  context_mode: string
  last_opened_at: string | null
  lifecycle_status: string
  workspace_session_id: number | null
  proposal_message_id: number | null
  created_at: string
  updated_at: string
}

function mapNote(r: NoteRow): WorldNote {
  return {
    id: r.id,
    worldId: r.world_id,
    title: r.title,
    content: r.content,
    category: r.category as NoteCategory,
    isPinned: toBool(r.is_pinned),
    contextMode: r.context_mode as NoteContextMode,
    lastOpenedAt: r.last_opened_at,
    lifecycleStatus: r.lifecycle_status as NoteLifecycleStatus,
    workspaceSessionId: r.workspace_session_id,
    proposalMessageId: r.proposal_message_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listWorldNotes(worldId: number): WorldNote[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM world_notes WHERE world_id = ? AND lifecycle_status = 'canonical'
       ORDER BY category, lower(title), id`
    )
    .all(worldId) as NoteRow[]
  return rows.map(mapNote)
}

export function getWorldNote(id: number): WorldNote | null {
  const row = getDb().prepare('SELECT * FROM world_notes WHERE id = ?').get(id) as NoteRow | undefined
  return row ? mapNote(row) : null
}

function validCategory(value: string | undefined): string {
  return value && (NOTE_CATEGORIES as readonly string[]).includes(value) ? value : 'Unsorted'
}

function validContext(value: string | undefined): string {
  return value && (NOTE_CONTEXT_MODES as readonly string[]).includes(value) ? value : 'relevant'
}

export function saveWorldNote(draft: WorldNoteDraft): number {
  const db = getDb()
  const ts = now()
  const category = validCategory(draft.category)
  const contextMode = validContext(draft.contextMode)
  if (draft.id) {
    db.prepare(
      `UPDATE world_notes SET title = ?, content = ?, category = ?, is_pinned = ?,
       context_mode = ?, updated_at = ? WHERE id = ?`
    ).run(draft.title, draft.content ?? '', category, draft.isPinned ? 1 : 0, contextMode, ts, draft.id)
    return draft.id
  }
  const lifecycle =
    draft.lifecycleStatus && (NOTE_LIFECYCLE_STATUSES as readonly string[]).includes(draft.lifecycleStatus)
      ? draft.lifecycleStatus
      : 'canonical'
  const info = db
    .prepare(
      `INSERT INTO world_notes (world_id, title, content, category, is_pinned, context_mode,
       lifecycle_status, workspace_session_id, proposal_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      draft.worldId,
      draft.title,
      draft.content ?? '',
      category,
      draft.isPinned ? 1 : 0,
      contextMode,
      lifecycle,
      draft.workspaceSessionId ?? null,
      draft.proposalMessageId ?? null,
      ts,
      ts
    )
  return Number(info.lastInsertRowid)
}

export function touchWorldNote(id: number): void {
  getDb().prepare('UPDATE world_notes SET last_opened_at = ? WHERE id = ?').run(now(), id)
}

export function duplicateWorldNote(id: number): WorldNote | null {
  const note = getWorldNote(id)
  if (!note) return null
  const existing = new Set(listWorldNotes(note.worldId).map((n) => n.title.toLowerCase()))
  const base = (note.title.trim() || 'Untitled') + ' copy'
  let title = base
  let suffix = 2
  while (existing.has(title.toLowerCase())) {
    title = `${base} ${suffix}`
    suffix += 1
  }
  const newId = saveWorldNote({
    worldId: note.worldId,
    title,
    content: note.content,
    category: note.category,
    contextMode: 'relevant',
    isPinned: false
  })
  return getWorldNote(newId)
}

export function deleteWorldNote(id: number): void {
  getDb().prepare('DELETE FROM world_notes WHERE id = ?').run(id)
}

// ------------------------------------------------------ notes chat

export function listNoteChatMessages(worldId: number): NoteChatMessage[] {
  const rows = getDb()
    .prepare('SELECT * FROM world_notes_chat WHERE world_id = ? ORDER BY id')
    .all(worldId) as { id: number; world_id: number; role: string; content: string; created_at: string }[]
  return rows.map((r) => ({
    id: r.id,
    worldId: r.world_id,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    createdAt: r.created_at
  }))
}

export function addNoteChatMessage(worldId: number, role: 'user' | 'assistant', content: string): number {
  const info = getDb()
    .prepare('INSERT INTO world_notes_chat (world_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(worldId, role, content, now())
  return Number(info.lastInsertRowid)
}

export function updateNoteChatMessage(id: number, content: string): void {
  getDb().prepare('UPDATE world_notes_chat SET content = ? WHERE id = ?').run(content, id)
}

/** Deleting a message also deletes its non-canonical proposal notes. */
export function deleteNoteChatMessage(id: number): void {
  const db = getDb()
  const run = db.transaction(() => {
    db.prepare(
      "DELETE FROM world_notes WHERE proposal_message_id = ? AND lifecycle_status != 'canonical'"
    ).run(id)
    db.prepare('DELETE FROM world_notes_chat WHERE id = ?').run(id)
  })
  run()
}

export function clearNoteChat(worldId: number): void {
  const db = getDb()
  const run = db.transaction(() => {
    const sessions = db
      .prepare('SELECT id FROM world_notes_workspace_sessions WHERE world_id = ? AND cleared_at IS NULL')
      .all(worldId) as { id: number }[]
    for (const session of sessions) {
      db.prepare(
        "DELETE FROM world_notes WHERE workspace_session_id = ? AND lifecycle_status != 'canonical'"
      ).run(session.id)
    }
    db.prepare('DELETE FROM world_notes_chat WHERE world_id = ?').run(worldId)
    db.prepare(
      'UPDATE world_notes_workspace_sessions SET cleared_at = ? WHERE world_id = ? AND cleared_at IS NULL'
    ).run(now(), worldId)
  })
  run()
}

// ------------------------------------------------------ prompt usage provenance

export function saveNotePromptUsage(
  messageId: number,
  entries: { noteId: number; fingerprint: string; reason: string }[]
): void {
  const db = getDb()
  const run = db.transaction(() => {
    db.prepare('DELETE FROM world_note_prompt_usage WHERE message_id = ?').run(messageId)
    const insert = db.prepare(
      `INSERT INTO world_note_prompt_usage (message_id, note_id, note_fingerprint, inclusion_reason)
       VALUES (?, ?, ?, ?)`
    )
    for (const e of entries) insert.run(messageId, e.noteId, e.fingerprint, e.reason)
  })
  run()
}

/** The note snapshot used by the latest completed assistant reply. */
export function latestNotePromptUsage(worldId: number): Record<number, { fingerprint: string; reason: string }> {
  const db = getDb()
  const assistant = db
    .prepare(
      "SELECT id FROM world_notes_chat WHERE world_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1"
    )
    .get(worldId) as { id: number } | undefined
  if (!assistant) return {}
  const request = db
    .prepare(
      "SELECT id FROM world_notes_chat WHERE world_id = ? AND role = 'user' AND id < ? ORDER BY id DESC LIMIT 1"
    )
    .get(worldId, assistant.id) as { id: number } | undefined
  if (!request) return {}
  const rows = db
    .prepare(
      'SELECT note_id, note_fingerprint, inclusion_reason FROM world_note_prompt_usage WHERE message_id = ?'
    )
    .all(request.id) as { note_id: number; note_fingerprint: string; inclusion_reason: string }[]
  return Object.fromEntries(
    rows.map((r) => [r.note_id, { fingerprint: r.note_fingerprint, reason: r.inclusion_reason }])
  )
}

// ------------------------------------------------------ suggestions (AI proposals)

export function saveNoteSuggestion(
  messageId: number,
  ordinal: number,
  actionType: NoteActionType,
  targetNoteId: number | null,
  payload: Record<string, unknown>
): number {
  const db = getDb()
  const run = db.transaction((): number => {
    const existing = db
      .prepare('SELECT id FROM world_note_suggestions WHERE message_id = ? AND ordinal = ?')
      .get(messageId, ordinal) as { id: number } | undefined
    if (existing) return existing.id

    const message = db.prepare('SELECT world_id FROM world_notes_chat WHERE id = ?').get(messageId) as
      | { world_id: number }
      | undefined
    if (!message) throw new Error('Suggestion message not found')
    const worldId = message.world_id

    let target = targetNoteId
    let storedPayload = payload

    if (actionType === 'create') {
      const active = db
        .prepare(
          'SELECT id FROM world_notes_workspace_sessions WHERE world_id = ? AND cleared_at IS NULL ORDER BY id DESC LIMIT 1'
        )
        .get(worldId) as { id: number } | undefined
      const sessionId =
        active?.id ??
        Number(
          db
            .prepare('INSERT INTO world_notes_workspace_sessions (world_id, started_at) VALUES (?, ?)')
            .run(worldId, now()).lastInsertRowid
        )

      // A revised create with the same title supersedes the earlier proposal.
      const title = String(payload['title'] ?? '').trim().toLowerCase()
      if (title) {
        const pending = db
          .prepare(
            `SELECT s.id, s.target_note_id, s.payload_json FROM world_note_suggestions s
             JOIN world_notes_chat m ON m.id = s.message_id
             WHERE m.world_id = ? AND s.status IN ('pending', 'rejected') AND s.action_type = 'create'`
          )
          .all(worldId) as { id: number; target_note_id: number | null; payload_json: string }[]
        for (const prior of pending) {
          const priorPayload = JSON.parse(prior.payload_json) as Record<string, unknown>
          if (String(priorPayload['title'] ?? '').trim().toLowerCase() === title) {
            db.prepare("UPDATE world_note_suggestions SET status = 'superseded' WHERE id = ?").run(prior.id)
            if (prior.target_note_id !== null) {
              db.prepare(
                "UPDATE world_notes SET lifecycle_status = 'superseded' WHERE id = ? AND lifecycle_status != 'canonical'"
              ).run(prior.target_note_id)
            }
          }
        }
      }

      const ts = now()
      // The proposal gets a real provisional note row with a stable id.
      target = Number(
        db
          .prepare(
            `INSERT INTO world_notes (world_id, title, content, category, is_pinned, context_mode,
             lifecycle_status, workspace_session_id, proposal_message_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`
          )
          .run(
            worldId,
            String(payload['title'] ?? ''),
            String(payload['content'] ?? ''),
            validCategory(payload['category'] as string | undefined),
            payload['is_pinned'] ? 1 : 0,
            validContext(payload['context_mode'] as string | undefined),
            sessionId,
            messageId,
            ts,
            ts
          ).lastInsertRowid
      )
      storedPayload = { ...payload, note_id: target }
    } else if (target !== null) {
      const targetRow = db
        .prepare('SELECT lifecycle_status FROM world_notes WHERE id = ? AND world_id = ?')
        .get(target, worldId) as { lifecycle_status: string } | undefined
      if (!targetRow) throw new Error('Suggestion target note not found')
      if (targetRow.lifecycle_status !== 'canonical') {
        db.prepare(
          "UPDATE world_notes SET lifecycle_status = 'proposed', proposal_message_id = ? WHERE id = ?"
        ).run(messageId, target)
      }
    }

    const info = db
      .prepare(
        `INSERT INTO world_note_suggestions (message_id, ordinal, action_type, target_note_id, payload_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(messageId, ordinal, actionType, target, JSON.stringify(storedPayload))
    return Number(info.lastInsertRowid)
  })
  return run()
}

interface SuggestionRow {
  id: number
  message_id: number
  ordinal: number
  action_type: string
  target_note_id: number | null
  payload_json: string
  status: string
}

function mapSuggestion(r: SuggestionRow): NoteSuggestion {
  return {
    id: r.id,
    messageId: r.message_id,
    ordinal: r.ordinal,
    actionType: r.action_type as NoteActionType,
    targetNoteId: r.target_note_id,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    status: r.status as SuggestionStatus
  }
}

export function getNoteSuggestion(id: number): NoteSuggestion | null {
  const row = getDb().prepare('SELECT * FROM world_note_suggestions WHERE id = ?').get(id) as
    | SuggestionRow
    | undefined
  return row ? mapSuggestion(row) : null
}

export function listNoteSuggestions(messageId: number): NoteSuggestion[] {
  const rows = getDb()
    .prepare('SELECT * FROM world_note_suggestions WHERE message_id = ? ORDER BY ordinal')
    .all(messageId) as SuggestionRow[]
  return rows.map(mapSuggestion)
}

export function setNoteSuggestionStatus(suggestionId: number, status: SuggestionStatus): void {
  const db = getDb()
  const run = db.transaction(() => {
    const suggestion = db
      .prepare('SELECT target_note_id FROM world_note_suggestions WHERE id = ?')
      .get(suggestionId) as { target_note_id: number | null } | undefined
    db.prepare('UPDATE world_note_suggestions SET status = ? WHERE id = ?').run(status, suggestionId)
    if (suggestion?.target_note_id != null && (status === 'rejected' || status === 'superseded')) {
      db.prepare(
        `UPDATE world_notes SET lifecycle_status = ? WHERE id = ? AND lifecycle_status != 'canonical'`
      ).run(status, suggestion.target_note_id)
    }
  })
  run()
}

export function approveNoteSuggestion(
  suggestionId: number,
  title: string,
  content: string,
  category: string,
  contextMode: string,
  isPinned: boolean
): number {
  const db = getDb()
  const run = db.transaction((): number => {
    const suggestion = db
      .prepare('SELECT target_note_id FROM world_note_suggestions WHERE id = ?')
      .get(suggestionId) as { target_note_id: number | null } | undefined
    if (!suggestion || suggestion.target_note_id == null) {
      throw new Error('The proposal no longer has a note')
    }
    const noteId = suggestion.target_note_id
    db.prepare(
      `UPDATE world_notes SET title = ?, content = ?, category = ?, is_pinned = ?, context_mode = ?,
       lifecycle_status = 'canonical', workspace_session_id = NULL, proposal_message_id = NULL,
       updated_at = ? WHERE id = ?`
    ).run(title, content, validCategory(category), isPinned ? 1 : 0, validContext(contextMode), now(), noteId)
    db.prepare("UPDATE world_note_suggestions SET status = 'approved' WHERE id = ?").run(suggestionId)
    return noteId
  })
  return run()
}

export interface ProposalLedgerEntry extends NoteSuggestion {
  lifecycleStatus: NoteLifecycleStatus | null
  noteTitle: string | null
  noteContent: string | null
  noteCategory: string | null
  noteContextMode: string | null
  noteIsPinned: boolean
}

export function listWorkspaceProposalLedger(worldId: number): ProposalLedgerEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*, n.lifecycle_status, n.title AS note_title, n.content AS note_content,
              n.category AS note_category, n.context_mode AS note_context_mode,
              n.is_pinned AS note_is_pinned
       FROM world_note_suggestions s
       JOIN world_notes_chat m ON m.id = s.message_id
       LEFT JOIN world_notes n ON n.id = s.target_note_id
       WHERE m.world_id = ?
         AND s.status IN ('pending', 'rejected', 'superseded')
         AND s.id = (
             SELECT MAX(s2.id) FROM world_note_suggestions s2
             WHERE s2.target_note_id = s.target_note_id
               AND s2.status IN ('pending', 'rejected', 'superseded')
         )
       ORDER BY s.id`
    )
    .all(worldId) as (SuggestionRow & {
    lifecycle_status: string | null
    note_title: string | null
    note_content: string | null
    note_category: string | null
    note_context_mode: string | null
    note_is_pinned: number | null
  })[]
  return rows.map((r) => ({
    ...mapSuggestion(r),
    lifecycleStatus: r.lifecycle_status as NoteLifecycleStatus | null,
    noteTitle: r.note_title,
    noteContent: r.note_content,
    noteCategory: r.note_category,
    noteContextMode: r.note_context_mode,
    noteIsPinned: toBool(r.note_is_pinned)
  }))
}

export function listPendingNoteSuggestions(worldId: number): ProposalLedgerEntry[] {
  return listWorkspaceProposalLedger(worldId).filter((s) => s.status === 'pending')
}

/** The stable note-id universe the AI is allowed to reference. */
export function listWorkspaceNoteIds(worldId: number): Set<number> {
  const rows = getDb()
    .prepare(
      `SELECT id FROM world_notes WHERE world_id = ?
       AND lifecycle_status IN ('canonical', 'proposed', 'rejected')`
    )
    .all(worldId) as { id: number }[]
  return new Set(rows.map((r) => r.id))
}

import { getDb } from '../connection'
import type { Message, MessageRole } from '@shared/types'
import { now } from './util'

interface MessageRow {
  id: number
  scene_id: number
  role: string
  character_id: number | null
  content: string
  emotion: string
  deleted_at: string | null
  created_at: string
}

function mapMessage(r: MessageRow): Message {
  return {
    id: r.id,
    sceneId: r.scene_id,
    role: r.role as MessageRole,
    characterId: r.character_id,
    content: r.content,
    emotion: r.emotion,
    deletedAt: r.deleted_at,
    createdAt: r.created_at
  }
}

export function listMessages(sceneId: number, includeDeleted = false): Message[] {
  const sql = includeDeleted
    ? 'SELECT * FROM messages WHERE scene_id = ? ORDER BY id'
    : 'SELECT * FROM messages WHERE scene_id = ? AND deleted_at IS NULL ORDER BY id'
  return (getDb().prepare(sql).all(sceneId) as MessageRow[]).map(mapMessage)
}

export function countMessages(sceneId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM messages WHERE scene_id = ? AND deleted_at IS NULL')
    .get(sceneId) as { c: number }
  return row.c
}

export function getMessage(id: number): Message | null {
  const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as
    | MessageRow
    | undefined
  return row ? mapMessage(row) : null
}

export interface NewMessage {
  sceneId: number
  role: MessageRole
  content: string
  characterId?: number | null
  emotion?: string
}

export function addMessage(input: NewMessage): number {
  const db = getDb()
  const ts = now()
  const info = db
    .prepare(
      `INSERT INTO messages (scene_id, role, character_id, content, emotion, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.sceneId, input.role, input.characterId ?? null, input.content, input.emotion ?? '', ts)
  db.prepare('UPDATE scenes SET updated_at = ? WHERE id = ?').run(ts, input.sceneId)
  return Number(info.lastInsertRowid)
}

export function updateMessage(id: number, content: string): void {
  getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
}

export function updateMessageWithEmotion(id: number, content: string, emotion: string): void {
  getDb().prepare('UPDATE messages SET content = ?, emotion = ? WHERE id = ?').run(content, emotion, id)
}

/** Soft delete: the row survives, prompts and exports skip it. */
export function deleteMessage(id: number): void {
  getDb().prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run(now(), id)
}

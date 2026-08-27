import { getDb } from '../connection'
import type { LoreEntry, LoreDraft } from '@shared/types'
import { assertNotHubManaged, now, parseJsonArray, toBool } from './util'

interface LoreRow {
  id: number
  world_id: number
  title: string
  content: string
  keywords_json: string
  always_include: number
  hub_id: string | null
  publication_id: string | null
  created_at: string
  updated_at: string
}

function mapLore(r: LoreRow): LoreEntry {
  return {
    id: r.id,
    worldId: r.world_id,
    title: r.title,
    content: r.content,
    keywords: effectiveKeywords(r),
    alwaysInclude: toBool(r.always_include),
    hubId: r.hub_id,
    publicationId: r.publication_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

/**
 * Hub lore keeps local keyword tuning in lore_keyword_overrides, keyed by the
 * document itself — the tuning belongs to the writer, not to the revision it
 * was first typed against, so a new publication does not undo it.
 */
function effectiveKeywords(r: LoreRow): string[] {
  if (r.hub_id) {
    const override = getDb()
      .prepare('SELECT keywords_json FROM lore_keyword_overrides WHERE hub_id = ?')
      .get(r.hub_id) as { keywords_json: string } | undefined
    if (override) return parseJsonArray(override.keywords_json)
  }
  return parseJsonArray(r.keywords_json)
}

export function listLoreEntries(worldId: number): LoreEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM lore_entries WHERE world_id = ? ORDER BY title, id')
    .all(worldId) as LoreRow[]
  return rows.map(mapLore)
}

export function saveLoreEntry(draft: LoreDraft): number {
  const db = getDb()
  const ts = now()
  const keywords = JSON.stringify((draft.keywords ?? []).map((k) => k.trim()).filter(Boolean))
  if (draft.id) {
    const existing = db.prepare('SELECT hub_id FROM lore_entries WHERE id = ?').get(draft.id) as
      | { hub_id: string | null }
      | undefined
    if (existing?.hub_id) {
      // Hub lore content is immutable; only the keyword tuning is writable, locally.
      db.prepare(
        `INSERT INTO lore_keyword_overrides (hub_id, keywords_json)
         VALUES (?, ?)
         ON CONFLICT(hub_id) DO UPDATE SET keywords_json = excluded.keywords_json`
      ).run(existing.hub_id, keywords)
      return draft.id
    }
    db.prepare(
      `UPDATE lore_entries SET title = ?, content = ?, keywords_json = ?, always_include = ?, updated_at = ?
       WHERE id = ?`
    ).run(draft.title, draft.content ?? '', keywords, draft.alwaysInclude ? 1 : 0, ts, draft.id)
    return draft.id
  }
  const info = db
    .prepare(
      `INSERT INTO lore_entries (world_id, title, content, keywords_json, always_include, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(draft.worldId, draft.title, draft.content ?? '', keywords, draft.alwaysInclude ? 1 : 0, ts, ts)
  return Number(info.lastInsertRowid)
}

export function deleteLoreEntry(id: number): void {
  const existing = getDb().prepare('SELECT hub_id FROM lore_entries WHERE id = ?').get(id) as
    | { hub_id: string | null }
    | undefined
  assertNotHubManaged(existing, 'lore entry')
  getDb().prepare('DELETE FROM lore_entries WHERE id = ?').run(id)
}

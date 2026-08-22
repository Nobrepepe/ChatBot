/** Pure note-workspace helpers: filtering, context selection, and AI actions. */

import { createHash } from 'node:crypto'
import { NOTE_CATEGORIES, type NoteChatMessage, type WorldNote } from '@shared/types'

const WORDS = /[\p{L}\p{N}]+/gu

const ACTION_BLOCK = new RegExp(
  [
    '```note_action\\s*\\n(?<direct>[\\s\\S]*?)\\s*\\n```',
    '`note_action`\\s*\\n?\\s*```json\\s*\\n(?<labelled>[\\s\\S]*?)\\s*\\n```',
    '```json\\s*\\n(?<generic>[\\s\\S]*?)\\s*\\n```',
    '(?:^|\\n)(?<bare>\\[\\s*\\{[\\s\\S]*\\}\\s*\\])\\s*$',
    '(?:^|\\n)(?<bareObject>\\{\\s*"type"\\s*:\\s*"(?:open|create|append|replace)"[\\s\\S]*\\})\\s*$'
  ].join('|'),
  'gi'
)

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its',
  'me', 'my', 'of', 'on', 'or', 'our', 'she', 'that', 'the', 'their', 'them',
  'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when', 'where', 'who',
  'will', 'with', 'you', 'your'
])

export interface SelectedNote {
  note: WorldNote
  reason: string
}

export interface NoteAction {
  ordinal: number
  actionType: 'open' | 'create' | 'append' | 'replace'
  targetNoteId: number | null
  payload: Record<string, unknown>
}

export function noteFingerprint(note: WorldNote): string {
  const raw = [note.title, note.content, note.category, note.contextMode, note.isPinned ? '1' : '0'].join('\0')
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

function tokens(value: string): Set<string> {
  const found = value.match(WORDS) ?? []
  return new Set(
    found
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t.toLowerCase()))
      .map((t) => t.toLowerCase())
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function exactTitleMatch(note: WorldNote, haystack: string): boolean {
  const title = note.title.trim()
  if (title.length < 3) return false
  return new RegExp(`(?<!\\w)${escapeRegExp(title)}(?!\\w)`, 'i').test(haystack)
}

const REASON_ORDER: Record<string, number> = {
  'always included': 0,
  'title referenced': 1,
  'active note': 2,
  'matched current discussion': 3
}

/** Select notes conservatively while respecting explicit exclusion. */
export function selectNotesForContext(
  notes: WorldNote[],
  currentMessage: string,
  history: NoteChatMessage[],
  activeNoteId: number | null = null,
  recentMessages = 6
): SelectedNote[] {
  const recentText = history.slice(-recentMessages).map((m) => m.content).join('\n')
  const haystack = `${currentMessage}\n${recentText}`.trim()
  const queryTokens = tokens(haystack)
  const selected = new Map<number, SelectedNote>()
  for (const note of notes) {
    if (note.contextMode === 'excluded') continue
    if (note.contextMode === 'always') {
      selected.set(note.id, { note, reason: 'always included' })
    } else if (note.id === activeNoteId) {
      selected.set(note.id, { note, reason: 'active note' })
    } else if (haystack && exactTitleMatch(note, haystack)) {
      selected.set(note.id, { note, reason: 'title referenced' })
    } else if (queryTokens.size >= 2) {
      const titleTokens = tokens(note.title)
      const contentTokens = tokens(note.content)
      const titleOverlap = [...queryTokens].filter((t) => titleTokens.has(t))
      const contentOverlap = [...queryTokens].filter((t) => contentTokens.has(t))
      if (titleOverlap.length > 0 || contentOverlap.length >= 2) {
        selected.set(note.id, { note, reason: 'matched current discussion' })
      }
    }
  }
  const categoryIndex = (c: string): number => {
    const i = (NOTE_CATEGORIES as readonly string[]).indexOf(c)
    return i < 0 ? NOTE_CATEGORIES.length : i
  }
  return [...selected.values()].sort((a, b) => {
    const byReason = (REASON_ORDER[a.reason] ?? 9) - (REASON_ORDER[b.reason] ?? 9)
    if (byReason) return byReason
    const byCategory = categoryIndex(a.note.category) - categoryIndex(b.note.category)
    if (byCategory) return byCategory
    const byTitle = a.note.title.toLowerCase().localeCompare(b.note.title.toLowerCase())
    if (byTitle) return byTitle
    return a.note.id - b.note.id
  })
}

export function filterNotes(
  notes: WorldNote[],
  query = '',
  selectedFilter: 'all' | 'recent' | 'pinned' = 'all'
): WorldNote[] {
  let result = [...notes]
  if (selectedFilter === 'pinned') {
    result = result.filter((n) => n.isPinned)
  } else if (selectedFilter === 'recent') {
    result.sort((a, b) => {
      const ka = a.lastOpenedAt || a.updatedAt || a.createdAt
      const kb = b.lastOpenedAt || b.updatedAt || b.createdAt
      return kb.localeCompare(ka)
    })
  }
  const needle = query.trim().toLowerCase()
  if (needle) {
    result = result.filter(
      (n) =>
        n.title.toLowerCase().includes(needle) ||
        n.content.toLowerCase().includes(needle) ||
        n.category.toLowerCase().includes(needle)
    )
  }
  return result
}

const CONTEXT_ALIASES: Record<string, string> = {
  always: 'always',
  'always included': 'always',
  relevant: 'relevant',
  character: 'relevant',
  contextual: 'relevant',
  'included when relevant': 'relevant',
  excluded: 'excluded',
  never: 'excluded'
}

/** Extract valid portable note_action blocks; invalid blocks remain visible. */
export function parseNoteActions(
  text: string,
  validNoteIds: Set<number>
): { visibleText: string; actions: NoteAction[] } {
  const actions: NoteAction[] = []
  const parts: string[] = []
  let cursor = 0
  let ordinal = 0
  for (const match of text.matchAll(ACTION_BLOCK)) {
    parts.push(text.slice(cursor, match.index))
    const groups = match.groups ?? {}
    const raw = groups['direct'] ?? groups['labelled'] ?? groups['generic'] ?? groups['bare'] ?? groups['bareObject']
    let consumed = false
    try {
      const decoded: unknown = JSON.parse(raw ?? '')
      const payloads = Array.isArray(decoded) ? decoded : [decoded]
      if (!payloads.length || !payloads.every((p) => p && typeof p === 'object' && !Array.isArray(p))) {
        throw new Error('invalid action payload')
      }
      const parsed: { actionType: NoteAction['actionType']; target: number | null; payload: Record<string, unknown> }[] = []
      for (const item of payloads as Record<string, unknown>[]) {
        const payload: Record<string, unknown> = { ...item }
        const actionType = String(payload['type'] ?? '').toLowerCase()
        if (!['open', 'create', 'append', 'replace'].includes(actionType)) {
          throw new Error('unsupported action')
        }
        let target: number | null = null
        if (actionType !== 'create') {
          const rawTarget = payload['note_id']
          if (typeof rawTarget !== 'number' || !Number.isInteger(rawTarget) || !validNoteIds.has(rawTarget)) {
            throw new Error('invalid target')
          }
          target = rawTarget
        } else {
          const category = payload['category']
          payload['category'] = (NOTE_CATEGORIES as readonly string[]).includes(String(category))
            ? category
            : 'Unsorted'
          payload['context_mode'] =
            CONTEXT_ALIASES[String(payload['context_mode'] ?? 'relevant').toLowerCase()] ?? 'relevant'
        }
        if (['create', 'append', 'replace'].includes(actionType) && typeof payload['content'] !== 'string') {
          throw new Error('missing content')
        }
        parsed.push({ actionType: actionType as NoteAction['actionType'], target, payload })
      }
      for (const { actionType, target, payload } of parsed) {
        actions.push({ ordinal, actionType, targetNoteId: target, payload })
        ordinal += 1
      }
      consumed = true
    } catch {
      /* fall through: keep the block visible */
    }
    if (!consumed) parts.push(match[0])
    cursor = match.index + match[0].length
  }
  parts.push(text.slice(cursor))
  return { visibleText: parts.join('').trim(), actions }
}

export { linkNoteReferences } from '@shared/noteLinks'

/** Internal app-note:// links for unique, sufficiently specific note titles. */

import type { WorldNote } from './types'

const PROTECTED_MARKDOWN = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]]+\]\([^)]+\))/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function linkNoteReferences(text: string, notes: Pick<WorldNote, 'id' | 'title'>[]): string {
  const byTitle = new Map<string, Pick<WorldNote, 'id' | 'title'>[]>()
  for (const note of notes) {
    const title = note.title.trim()
    if (title.length >= 3) {
      const key = title.toLowerCase()
      byTitle.set(key, [...(byTitle.get(key) ?? []), note])
    }
  }
  const unique = [...byTitle.values()].filter((list) => list.length === 1).map((list) => list[0]!)
  unique.sort((a, b) => b.title.length - a.title.length)
  if (!unique.length) return text

  const pattern = new RegExp(
    `(?<!\\w)(${unique.map((n) => escapeRegExp(n.title)).join('|')})(?!\\w)`,
    'gi'
  )
  const ids = new Map(unique.map((n) => [n.title.toLowerCase(), n.id]))
  const linkSegment = (segment: string): string =>
    segment.replace(pattern, (m) => `[${m}](app-note://${ids.get(m.toLowerCase())})`)

  const parts = text.split(PROTECTED_MARKDOWN)
  return parts.map((part, index) => (index % 2 ? part : linkSegment(part))).join('')
}

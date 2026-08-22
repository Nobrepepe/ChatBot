import { describe, it, expect } from 'vitest'
import { filterNotes, noteFingerprint, selectNotesForContext } from '@main/services/notesService'
import type { NoteChatMessage, WorldNote } from '@shared/types'

let idCounter = 0
function note(title: string, extra: Partial<WorldNote> = {}): WorldNote {
  return {
    id: ++idCounter,
    worldId: 1,
    title,
    content: '',
    category: 'Unsorted',
    isPinned: false,
    contextMode: 'relevant',
    lastOpenedAt: null,
    lifecycleStatus: 'canonical',
    workspaceSessionId: null,
    proposalMessageId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...extra
  }
}

function msg(content: string): NoteChatMessage {
  return { id: ++idCounter, worldId: 1, role: 'user', content, createdAt: '' }
}

describe('selectNotesForContext', () => {
  it('always includes always-notes and drops excluded even when active', () => {
    const always = note('Rules', { contextMode: 'always' })
    const excluded = note('Secret', { contextMode: 'excluded' })
    const selected = selectNotesForContext([always, excluded], 'anything', [], excluded.id)
    expect(selected.map((s) => s.note.id)).toEqual([always.id])
    expect(selected[0]!.reason).toBe('always included')
  })

  it('marks the active note and exact title references', () => {
    const active = note('Harbor')
    const titled = note('The Storm Bell')
    const selected = selectNotesForContext(
      [active, titled],
      'What rings The Storm Bell at dusk?',
      [],
      active.id
    )
    const reasons = Object.fromEntries(selected.map((s) => [s.note.title, s.reason]))
    expect(reasons['Harbor']).toBe('active note')
    expect(reasons['The Storm Bell']).toBe('title referenced')
  })

  it('matches discussion by token overlap only with two or more query tokens', () => {
    const overlap = note('Village customs', {
      content: 'The harvest festival happens under the red moon.'
    })
    const selected = selectNotesForContext([overlap], 'Tell me about the harvest festival', [])
    expect(selected[0]?.reason).toBe('matched current discussion')
    expect(selectNotesForContext([overlap], 'festival', [])).toHaveLength(0)
  })

  it('searches only the recent history window', () => {
    const titled = note('The Storm Bell')
    const old = msg('The Storm Bell rang.')
    const recent = Array.from({ length: 6 }, () => msg('quiet'))
    expect(selectNotesForContext([titled], '', [old, ...recent])).toHaveLength(0)
    expect(selectNotesForContext([titled], '', [...recent.slice(1), old])).toHaveLength(1)
  })

  it('orders by reason rank then category then title', () => {
    const a = note('Zeta', { contextMode: 'always', category: 'Plot' })
    const b = note('The Storm Bell', { category: 'Setting' })
    const c = note('Alpha', { contextMode: 'always', category: 'Characters' })
    const selected = selectNotesForContext([a, b, c], 'The Storm Bell', [])
    expect(selected.map((s) => s.note.title)).toEqual(['Alpha', 'Zeta', 'The Storm Bell'])
  })
})

describe('filterNotes', () => {
  const pinned = note('Pinned', { isPinned: true })
  const recentNote = note('Fresh', { lastOpenedAt: '2026-08-01' })
  const older = note('Old', { updatedAt: '2025-01-01' })

  it('filters pinned and searches title/content/category', () => {
    expect(filterNotes([pinned, older], '', 'pinned')).toEqual([pinned])
    expect(filterNotes([pinned, older], 'old', 'all').map((n) => n.title)).toEqual(['Old'])
    const categorized = note('X', { category: 'Plot' })
    expect(filterNotes([categorized], 'plot', 'all')).toHaveLength(1)
  })

  it('sorts recent by last opened / updated / created', () => {
    const result = filterNotes([older, recentNote], '', 'recent')
    expect(result[0]!.title).toBe('Fresh')
  })
})

describe('noteFingerprint', () => {
  it('changes with any tracked field', () => {
    const base = note('A', { content: 'x' })
    const changedPin = { ...base, isPinned: true }
    const changedMode = { ...base, contextMode: 'always' as const }
    expect(noteFingerprint(base)).not.toBe(noteFingerprint(changedPin))
    expect(noteFingerprint(base)).not.toBe(noteFingerprint(changedMode))
    expect(noteFingerprint(base)).toBe(noteFingerprint({ ...base }))
  })
})

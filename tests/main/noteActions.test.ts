import { describe, it, expect } from 'vitest'
import { linkNoteReferences, parseNoteActions } from '@main/services/notesService'
import type { WorldNote } from '@shared/types'

const validIds = new Set([1, 2, 68])

function note(id: number, title: string, extra: Partial<WorldNote> = {}): WorldNote {
  return {
    id,
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
    createdAt: '',
    updatedAt: '',
    ...extra
  }
}

describe('parseNoteActions', () => {
  it('extracts a direct note_action fence', () => {
    const text =
      'Here is a thought.\n\n```note_action\n{"type":"append","note_id":1,"content":"More."}\n```'
    const { visibleText, actions } = parseNoteActions(text, validIds)
    expect(visibleText).toBe('Here is a thought.')
    expect(actions).toEqual([
      { ordinal: 0, actionType: 'append', targetNoteId: 1, payload: { type: 'append', note_id: 1, content: 'More.' } }
    ])
  })

  it('accepts a labelled json fence and a generic json fence', () => {
    const labelled =
      '`note_action`\n```json\n{"type":"open","note_id":2}\n```'
    expect(parseNoteActions(labelled, validIds).actions).toHaveLength(1)
    const generic = 'Reply.\n\n```json\n{"type":"replace","note_id":2,"content":"New."}\n```'
    const parsed = parseNoteActions(generic, validIds)
    expect(parsed.actions[0]!.actionType).toBe('replace')
    expect(parsed.visibleText).toBe('Reply.')
  })

  it('accepts a bare trailing JSON array and a bare object', () => {
    const array = 'Sure.\n[{"type":"open","note_id":1},{"type":"open","note_id":2}]'
    const parsedArray = parseNoteActions(array, validIds)
    expect(parsedArray.actions.map((a) => a.targetNoteId)).toEqual([1, 2])
    expect(parsedArray.actions.map((a) => a.ordinal)).toEqual([0, 1])

    const object = 'Done.\n{"type":"append","note_id":68,"content":"x"}'
    expect(parseNoteActions(object, validIds).actions[0]!.targetNoteId).toBe(68)
  })

  it('leaves invalid blocks visible', () => {
    const badTarget = 'Hmm.\n\n```note_action\n{"type":"append","note_id":99,"content":"x"}\n```'
    const parsed = parseNoteActions(badTarget, validIds)
    expect(parsed.actions).toHaveLength(0)
    expect(parsed.visibleText).toContain('note_id":99')

    const badType = '```note_action\n{"type":"delete","note_id":1}\n```'
    expect(parseNoteActions(badType, validIds).actions).toHaveLength(0)

    const missingContent = '```note_action\n{"type":"replace","note_id":1}\n```'
    expect(parseNoteActions(missingContent, validIds).actions).toHaveLength(0)
  })

  it('normalizes create category and context_mode aliases', () => {
    const text =
      '```note_action\n{"type":"create","title":"Bran","category":"People","content":"A smith.","context_mode":"character"}\n```'
    const { actions } = parseNoteActions(text, validIds)
    expect(actions[0]!.payload['category']).toBe('Unsorted')
    expect(actions[0]!.payload['context_mode']).toBe('relevant')
    expect(actions[0]!.targetNoteId).toBeNull()
  })
})

describe('linkNoteReferences', () => {
  const notes = [note(1, 'The Accord'), note(2, 'Mist'), note(3, 'Mist')]

  it('links unique titles and skips duplicates', () => {
    const linked = linkNoteReferences('The Accord holds. Mist rises.', notes)
    expect(linked).toContain('[The Accord](app-note://1)')
    expect(linked).not.toContain('app-note://2')
  })

  it('never links inside code or existing links', () => {
    const text = 'See `The Accord` and [The Accord](https://x) and The Accord.'
    const linked = linkNoteReferences(text, [note(1, 'The Accord')])
    expect(linked).toBe('See `The Accord` and [The Accord](https://x) and [The Accord](app-note://1).')
  })

  it('ignores short titles', () => {
    expect(linkNoteReferences('Go up.', [note(1, 'Go')])).toBe('Go up.')
  })
})

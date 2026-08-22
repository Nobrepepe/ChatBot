import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useTempDataDir } from './helpers'
import * as worlds from '@main/db/repo/worlds'
import * as notes from '@main/db/repo/notes'
import { approveSuggestion } from '@main/services/notesWorkspace'
import { buildNotesChatPrompt } from '@main/prompt/notesPrompt'

let cleanup: () => void
let worldId: number

beforeEach(() => {
  cleanup = useTempDataDir()
  worldId = worlds.saveWorld({ name: 'Eden', summary: 'A vale.' })
})

afterEach(() => cleanup())

function assistantMessage(): number {
  notes.addNoteChatMessage(worldId, 'user', 'Please draft a note about Bran.')
  return notes.addNoteChatMessage(worldId, 'assistant', 'Here is a draft.')
}

describe('proposal lifecycle', () => {
  it('create allocates a provisional note with a stable id and injects note_id', () => {
    const messageId = assistantMessage()
    const suggestionId = notes.saveNoteSuggestion(messageId, 0, 'create', null, {
      type: 'create',
      title: 'Bran',
      content: 'A smith.',
      category: 'Characters',
      context_mode: 'relevant'
    })
    const suggestion = notes.getNoteSuggestion(suggestionId)!
    expect(suggestion.targetNoteId).not.toBeNull()
    expect(suggestion.payload['note_id']).toBe(suggestion.targetNoteId)
    const provisional = notes.getWorldNote(suggestion.targetNoteId!)!
    expect(provisional.lifecycleStatus).toBe('proposed')
    // Provisional notes never appear in the canonical list…
    expect(notes.listWorldNotes(worldId)).toHaveLength(0)
    // …but their id is valid for follow-up actions.
    expect(notes.listWorkspaceNoteIds(worldId).has(provisional.id)).toBe(true)
  })

  it('is idempotent on (message, ordinal)', () => {
    const messageId = assistantMessage()
    const payload = { type: 'create', title: 'Bran', content: 'x' }
    const first = notes.saveNoteSuggestion(messageId, 0, 'create', null, payload)
    const second = notes.saveNoteSuggestion(messageId, 0, 'create', null, payload)
    expect(second).toBe(first)
  })

  it('a revised create with the same title supersedes the older proposal', () => {
    const m1 = assistantMessage()
    const s1 = notes.saveNoteSuggestion(m1, 0, 'create', null, { type: 'create', title: 'Bran', content: 'v1' })
    const m2 = assistantMessage()
    const s2 = notes.saveNoteSuggestion(m2, 0, 'create', null, { type: 'create', title: 'bran', content: 'v2' })
    expect(notes.getNoteSuggestion(s1)!.status).toBe('superseded')
    const oldNote = notes.getWorldNote(notes.getNoteSuggestion(s1)!.targetNoteId!)!
    expect(oldNote.lifecycleStatus).toBe('superseded')
    expect(notes.getNoteSuggestion(s2)!.status).toBe('pending')
  })

  it('approval makes the note canonical and clears session/proposal links', () => {
    const messageId = assistantMessage()
    const suggestionId = notes.saveNoteSuggestion(messageId, 0, 'create', null, {
      type: 'create',
      title: 'Bran',
      content: 'A smith.'
    })
    const noteId = approveSuggestion(suggestionId, {
      title: 'Bran the Smith',
      content: 'A quiet smith.',
      category: 'Characters',
      contextMode: 'relevant',
      isPinned: false
    })
    const approved = notes.getWorldNote(noteId)!
    expect(approved.lifecycleStatus).toBe('canonical')
    expect(approved.title).toBe('Bran the Smith')
    expect(approved.workspaceSessionId).toBeNull()
    expect(approved.proposalMessageId).toBeNull()
    expect(notes.getNoteSuggestion(suggestionId)!.status).toBe('approved')
    expect(notes.listWorldNotes(worldId)).toHaveLength(1)
  })

  it('approving an append merges onto the target content', () => {
    const noteId = notes.saveWorldNote({ worldId, title: 'Harbor', content: 'Old docks.  ' })
    const messageId = assistantMessage()
    const suggestionId = notes.saveNoteSuggestion(messageId, 0, 'append', noteId, {
      type: 'append',
      note_id: noteId,
      content: 'New pier.'
    })
    approveSuggestion(suggestionId, {
      title: 'Harbor',
      content: 'New pier.',
      category: 'Setting',
      contextMode: 'relevant',
      isPinned: false
    })
    expect(notes.getWorldNote(noteId)!.content).toBe('Old docks.\n\nNew pier.')
  })

  it('rejection keeps the note revisable; clear removes non-canonical notes only', () => {
    const messageId = assistantMessage()
    const suggestionId = notes.saveNoteSuggestion(messageId, 0, 'create', null, {
      type: 'create',
      title: 'Bran',
      content: 'v1'
    })
    const provisionalId = notes.getNoteSuggestion(suggestionId)!.targetNoteId!
    notes.setNoteSuggestionStatus(suggestionId, 'rejected')
    expect(notes.getWorldNote(provisionalId)!.lifecycleStatus).toBe('rejected')
    // Rejected notes stay referenceable for a replace-style revision.
    expect(notes.listWorkspaceNoteIds(worldId).has(provisionalId)).toBe(true)

    const canonical = notes.saveWorldNote({ worldId, title: 'Keep me', content: 'stays' })
    notes.clearNoteChat(worldId)
    expect(notes.getWorldNote(provisionalId)).toBeNull()
    expect(notes.getWorldNote(canonical)).not.toBeNull()
    expect(notes.listNoteChatMessages(worldId)).toHaveLength(0)
  })

  it('deleting an assistant message deletes its non-canonical proposals', () => {
    const messageId = assistantMessage()
    const suggestionId = notes.saveNoteSuggestion(messageId, 0, 'create', null, {
      type: 'create',
      title: 'Bran',
      content: 'v1'
    })
    const provisionalId = notes.getNoteSuggestion(suggestionId)!.targetNoteId!
    notes.deleteNoteChatMessage(messageId)
    expect(notes.getWorldNote(provisionalId)).toBeNull()
  })
})

describe('duplicateWorldNote', () => {
  it('names copies uniquely and resets pin/context', () => {
    const id = notes.saveWorldNote({
      worldId,
      title: 'Harbor',
      content: 'Docks.',
      contextMode: 'always',
      isPinned: true
    })
    const first = notes.duplicateWorldNote(id)!
    expect(first.title).toBe('Harbor copy')
    expect(first.contextMode).toBe('relevant')
    expect(first.isPinned).toBe(false)
    const second = notes.duplicateWorldNote(id)!
    expect(second.title).toBe('Harbor copy 2')
  })
})

describe('buildNotesChatPrompt', () => {
  it('formats notes with reasons and renders the proposal ledger with stable ids', () => {
    const world = worlds.getWorld(worldId)!
    const noteId = notes.saveWorldNote({ worldId, title: 'Harbor', content: 'Docks.', category: 'Setting' })
    const messageId = assistantMessage()
    notes.saveNoteSuggestion(messageId, 0, 'replace', noteId, {
      type: 'replace',
      note_id: noteId,
      content: 'Proposed docks.'
    })
    const history = notes.listNoteChatMessages(worldId)
    const stored = notes.getWorldNote(noteId)!
    const messages = buildNotesChatPrompt(
      world,
      [stored],
      history,
      { [noteId]: 'always included' },
      notes.listWorkspaceProposalLedger(worldId)
    )
    const system = messages[0]!.content
    expect(system).toContain('Summary: A vale.')
    expect(system).toContain(`[Setting Note id=${noteId}: Harbor — always included]`)
    expect(system).toContain(`[Workspace Note id=${noteId} · note_status=canonical · proposal_status=pending]`)
    expect(system).toContain('Proposed docks.')
    expect(system).toContain('never guess an ID')
    expect(messages.at(-1)!.role).toBe('assistant')
    expect(messages.at(-2)!.content).toBe('Please draft a note about Bran.')
  })
})

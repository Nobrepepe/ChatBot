/**
 * Notes-workspace orchestration: context selection, prompt building, response
 * parsing into reviewable proposals, and approval merging.
 */

import * as notesRepo from '../db/repo/notes'
import * as worldsRepo from '../db/repo/worlds'
import * as settingsRepo from '../db/repo/settings'
import { streamChat } from '../providers/openaiCompat'
import { buildNotesChatPrompt } from '../prompt/notesPrompt'
import {
  linkNoteReferences,
  noteFingerprint,
  parseNoteActions,
  selectNotesForContext,
  type SelectedNote
} from './notesService'

export interface ContextPreviewEntry {
  noteId: number
  title: string
  reason: string
}

export function contextPreview(
  worldId: number,
  currentMessage: string,
  activeNoteId: number | null
): ContextPreviewEntry[] {
  const notes = notesRepo.listWorldNotes(worldId)
  const history = notesRepo.listNoteChatMessages(worldId)
  return selectNotesForContext(notes, currentMessage, history, activeNoteId).map((s) => ({
    noteId: s.note.id,
    title: s.note.title,
    reason: s.reason
  }))
}

/**
 * Runs one assistant turn. When `userMessage` is given it is persisted first;
 * otherwise the latest stored user message is treated as the request
 * (regenerate). Yields visible chunks; parsing happens on completion.
 */
export async function* generateNotesReply(
  worldId: number,
  userMessage: string | null,
  activeNoteId: number | null,
  signal: AbortSignal
): AsyncGenerator<string, void> {
  const world = worldsRepo.getWorld(worldId)
  if (!world) throw new Error('This world no longer exists.')

  let requestMessageId: number
  if (userMessage?.trim()) {
    requestMessageId = notesRepo.addNoteChatMessage(worldId, 'user', userMessage.trim())
  } else {
    const lastUser = notesRepo
      .listNoteChatMessages(worldId)
      .filter((m) => m.role === 'user')
      .at(-1)
    if (!lastUser) throw new Error('Nothing to answer yet — say something first.')
    requestMessageId = lastUser.id
  }

  const history = notesRepo.listNoteChatMessages(worldId)
  const request = history.find((m) => m.id === requestMessageId)!
  const notes = notesRepo.listWorldNotes(worldId)
  const selected: SelectedNote[] = selectNotesForContext(
    notes,
    request.content,
    history.filter((m) => m.id !== requestMessageId),
    activeNoteId
  )
  const reasons = Object.fromEntries(selected.map((s) => [s.note.id, s.reason]))
  const ledger = notesRepo.listWorkspaceProposalLedger(worldId)
  const messages = buildNotesChatPrompt(
    world,
    selected.map((s) => s.note),
    history,
    reasons,
    ledger
  )

  notesRepo.saveNotePromptUsage(
    requestMessageId,
    selected.map((s) => ({
      noteId: s.note.id,
      fingerprint: noteFingerprint(s.note),
      reason: s.reason
    }))
  )

  let raw = ''
  try {
    for await (const delta of streamChat(messages, settingsRepo.getSettings(), signal)) {
      raw += delta
      yield delta
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') throw err
  }

  const text = raw.trim()
  if (!text) return

  const { visibleText, actions } = parseNoteActions(text, notesRepo.listWorkspaceNoteIds(worldId))
  let finalText = visibleText || '(The assistant sent only a note action.)'
  const assistantId = notesRepo.addNoteChatMessage(worldId, 'assistant', finalText)

  const failures: string[] = []
  for (const action of actions) {
    try {
      notesRepo.saveNoteSuggestion(
        assistantId,
        action.ordinal,
        action.actionType,
        action.targetNoteId,
        action.payload
      )
    } catch {
      failures.push("Couldn't prepare one note action because its target no longer exists.")
    }
  }
  if (failures.length) {
    finalText = `${finalText}\n\n${[...new Set(failures)].join('\n')}`
    notesRepo.updateNoteChatMessage(assistantId, finalText)
  }
}

/** Approve with user edits; merging depends on the action type. */
export function approveSuggestion(
  suggestionId: number,
  edited: { title: string; content: string; category: string; contextMode: string; isPinned: boolean }
): number {
  const suggestion = notesRepo.getNoteSuggestion(suggestionId)
  if (!suggestion) throw new Error('The proposal no longer exists.')
  const target = suggestion.targetNoteId != null ? notesRepo.getWorldNote(suggestion.targetNoteId) : null

  let content = edited.content
  if (suggestion.actionType === 'append' && target) {
    content = target.content.replace(/\s+$/, '') + '\n\n' + edited.content.trim()
  }
  return notesRepo.approveNoteSuggestion(
    suggestionId,
    edited.title,
    content,
    edited.category,
    edited.contextMode,
    edited.isPinned
  )
}

export { linkNoteReferences }

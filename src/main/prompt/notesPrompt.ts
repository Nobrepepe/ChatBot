/** Prompt for the worldbuilding notes workspace assistant. */

import type { NoteChatMessage, World, WorldNote } from '@shared/types'
import type { ChatMessage } from '../providers/openaiCompat'
import { buildWorldSection } from './promptBuilder'
import type { ProposalLedgerEntry } from '../db/repo/notes'

export function buildNotesChatPrompt(
  world: World,
  notes: WorldNote[],
  history: NoteChatMessage[],
  inclusionReasons: Record<number, string> = {},
  proposalLedger: ProposalLedgerEntry[] = []
): ChatMessage[] {
  const systemParts = [
    'You are a thoughtful worldbuilding and writing assistant helping the ' +
      'user develop their fictional world. You are NOT roleplaying a ' +
      'character; this is a craft conversation between collaborators. ' +
      'Brainstorm, ask probing questions, point out contradictions, gaps, ' +
      'and untapped potential in the notes, and suggest concrete directions. ' +
      "Respect the user's creative ownership: build on their ideas rather " +
      'than replacing them. When asked to revise or draft a note, output ' +
      'text the user can paste directly into it. The notes below are the ' +
      "user's private working notes - treat them as drafts, not fixed canon.",
    'When a concrete note action would help, you may append a fenced ' +
      '`note_action` JSON block after your normal reply. Put exactly one ' +
      'JSON object in each block using this form:\n' +
      '```note_action\n' +
      '{"type":"create","title":"Title","category":"Characters",' +
      '"content":"Draft text","context_mode":"relevant","is_pinned":false}\n' +
      '```\nSupported types ' +
      'are open, append, replace, and create. For open/append/replace use ' +
      'a listed integer note_id. For append/replace include `content`. ' +
      'For create include title, category, content, context_mode, and ' +
      'is_pinned. Valid categories are Characters, Setting, Plot, and ' +
      'Unsorted. Valid context_mode values are always, relevant, and ' +
      'excluded. Do not wrap actions in an array or a generic `json` fence. ' +
      'Never claim an action happened; the user must review it.',
    '## World\n' + (buildWorldSection(world) || '(no details yet)')
  ]

  if (notes.length) {
    const blocks = notes.map((note, index) => {
      const title = note.title.trim() || `Untitled note ${index + 1}`
      const reason = inclusionReasons[note.id] ?? 'included'
      const content = note.content.trim() || '(empty)'
      return `[${note.category} Note id=${note.id}: ${title} — ${reason}]\n${content}`
    })
    systemParts.push('## Worldbuilding notes selected for this message\n' + blocks.join('\n\n'))
  } else {
    systemParts.push(
      '## Worldbuilding notes selected for this message\n(No notes are included for this message.)'
    )
  }

  if (proposalLedger.length) {
    const proposalLines = proposalLedger.map((proposal) => {
      const payload = proposal.payload
      const noteStatus = proposal.lifecycleStatus ?? 'missing'
      const stored = proposal.noteContent ?? ''
      let displayed: string
      if (proposal.status === 'pending' && proposal.actionType === 'replace') {
        displayed = String(payload['content'] ?? stored)
      } else if (proposal.status === 'pending' && proposal.actionType === 'append') {
        displayed = stored.replace(/\s+$/, '') + '\n\n' + String(payload['content'] ?? '').trim()
      } else {
        displayed = stored || String(payload['content'] ?? '')
      }
      return (
        `[Workspace Note id=${proposal.targetNoteId} · note_status=${noteStatus} · ` +
        `proposal_status=${proposal.status}]\n` +
        `Proposal record: ${proposal.id}\n` +
        `Last action: ${proposal.actionType}\n` +
        `Title: ${proposal.noteTitle || String(payload['title'] ?? '')}\n` +
        `Category: ${proposal.noteCategory || String(payload['category'] ?? '')}\n` +
        `Stored provisional content:\n${displayed}`
      )
    })
    systemParts.push(
      '## Workspace proposal ledger\n' +
        'These entries have real stable note IDs. note_status describes the ' +
        'stored note; proposal_status describes the unapproved action. Proposed ' +
        'replacement or appended content is never canonical until the user ' +
        'approves it, even when note_status is canonical. You may use listed ' +
        'note_id values with replace, append, or open; never guess an ID. A ' +
        'rejected note remains available for revision during this chat. A new ' +
        'create action is only for a genuinely different note. After you emit a ' +
        'create action, its allocated ID will appear in the next prompt.\n\n' +
        proposalLines.join('\n\n')
    )
  }

  const messages: ChatMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }]
  for (const message of history) {
    messages.push({ role: message.role === 'user' ? 'user' : 'assistant', content: message.content })
  }
  return messages
}

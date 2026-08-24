/** One-shot prompts: summary, impersonation, continuation, memory suggestions. */

import type { Character, Memory, MemoryProposal, Message, Persona, Scene } from '@shared/types'
import type { ChatMessage } from '../providers/openaiCompat'
import type { BuiltPrompt } from './promptBuilder'

/** Flattens a transcript with speaker labels from the structured columns. */
function transcriptLines(characters: Character[], history: Message[]): string[] {
  const nameById = new Map(characters.map((c) => [c.id, c.name]))
  const lines: string[] = []
  for (const m of history) {
    if (m.deletedAt || m.role === 'system-note') continue
    if (m.role === 'user') {
      lines.push(`User: ${m.content}`)
    } else if (m.role === 'narrator') {
      lines.push(m.content)
    } else {
      const name = (m.characterId != null && nameById.get(m.characterId)) || characters[0]?.name
      lines.push(name ? `${name}: ${m.content}` : m.content)
    }
  }
  return lines
}

export function buildSummaryPrompt(
  characters: Character[],
  scene: Scene,
  history: Message[]
): ChatMessage[] {
  const transcript = transcriptLines(characters, history).join('\n')
  const system =
    'You are a helpful writing assistant. Summarize the scene transcript ' +
    'below in a compact way that preserves everything important: key events, ' +
    'emotional shifts, revelations, promises, and changes in the relationship. ' +
    'Write it as a short list of plain factual sentences. Do not invent details.'
  const user = `Scene: ${scene.title || '(untitled)'}\n\nTranscript:\n${transcript}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

/** The OOC turn that flips the model from the character to the user persona. */
export function impersonationInstruction(personaName: string, draft = ''): string {
  let text =
    '[OOC: Set the character aside for this one turn. Write one possible next ' +
    `turn for ${personaName}, the USER persona, instead — not for any ` +
    'character. Infer it from the persona description, the scene, and the ' +
    'conversation above: what the persona says and, when natural, a brief ' +
    'action in roleplay prose. Never decide major irreversible actions for the ' +
    'user, and never write anyone else\'s turn. Output ONLY the suggested ' +
    'turn: no explanation, no speaker label, no sprite call sign, no quotation ' +
    'wrapper around the whole response, and no comment on this instruction.]'
  if (draft.trim()) {
    text += `\n\n[Unfinished draft to build on, as optional guidance:\n${draft.trim()}]`
  }
  return text
}

/**
 * Impersonation reuses the reply prompt byte for byte and steers with a
 * trailing OOC turn, the way a continuation does. Rewriting the system message
 * to drop the character instructions would read better in isolation, but it
 * changes token zero: a local server then has no usable prefix cache and
 * reprocesses the whole context — tens of thousands of tokens — every time the
 * user alternates between a reply and a suggestion.
 */
export function buildImpersonationPrompt(
  context: BuiltPrompt,
  persona: Persona,
  draft = ''
): ChatMessage[] {
  return [
    ...context.messages,
    { role: 'user', content: impersonationInstruction(persona.name, draft) }
  ]
}

export const CONTINUE_INSTRUCTION =
  '[OOC: Your reply above was cut off. Continue it from exactly where it ' +
  'stops, even if that is mid-sentence, keeping the same voice, tense, and ' +
  'formatting. Output ONLY the continuation: do not repeat any text already ' +
  'written, do not restart the reply, do not add a speaker label or sprite ' +
  'call sign, and do not comment on this instruction. Include a leading ' +
  'space or line break if the existing text needs one.]'

/** `context.messages` must end with the history *before* the reply being continued. */
export function buildContinuationPrompt(context: BuiltPrompt, partial: string): ChatMessage[] {
  return [
    ...context.messages,
    { role: 'assistant', content: partial },
    { role: 'user', content: CONTINUE_INSTRUCTION }
  ]
}

export interface MemoryPromptInput {
  characters: Character[]
  scene: Scene
  history: Message[]
  /** Canonical memories per character id — what the model may revise. */
  memoriesByChar: Map<number, Memory[]>
  /** Proposals the user has not resolved yet, so a second pass revises them. */
  ledger: MemoryProposal[]
}

const MEMORY_ACTION_CONTRACT =
  'Propose changes by appending fenced `memory_action` JSON blocks after any ' +
  'brief note you write. Put exactly one JSON object in each block:\n' +
  '```memory_action\n' +
  '{"type":"replace","memory_id":12,"memory_type":"relationship",' +
  '"content":"Daniela trusts the user completely."}\n' +
  '```\n' +
  'Supported types are create, replace and forget.\n' +
  '- create: include character_id, memory_type and content.\n' +
  '- replace: include a listed integer memory_id, content, and memory_type.\n' +
  '- forget: include a listed integer memory_id and a short reason.\n' +
  'Valid memory_type values are canon (permanently true of the character), ' +
  'relationship (how they currently feel about the user), and session ' +
  '(scene-local, never sent to the model). Never guess an id that is not ' +
  'listed. Never claim a change happened — the user reviews every action.'

const MEMORY_REVISION_RULE =
  'A memory is the current state, not a diary. When something listed below is ' +
  'now out of date, REPLACE it rather than creating a second memory that ' +
  'contradicts it: a character has one relationship memory, not a history of ' +
  'them. Use forget only when a memory has become false and nothing replaces ' +
  'it. Create only for something genuinely new. Prefer few, load-bearing ' +
  'changes: propose at most six actions.'

/**
 * The memory pass is the notes workspace applied to a character: every memory
 * carries a stable id, and the model is shown what it already proposed, so it
 * revises the relationship memory instead of stacking a contradicting one
 * beside it.
 */
export function buildMemorySuggestionPrompt(input: MemoryPromptInput): ChatMessage[] {
  const { characters, scene, history, memoriesByChar, ledger } = input
  const transcript = transcriptLines(characters, history).join('\n')
  const names = characters.map((c) => `${c.name} (character_id=${c.id})`).join(', ')

  const parts = [
    'You are a careful writing assistant maintaining the long-term memory of ' +
      `the character(s): ${names}. Read the scene transcript and decide what ` +
      'their memory should say now. Focus on revelations, promises, ' +
      'decisions, relationship changes, and new canon. Do not invent anything ' +
      'the transcript does not support.',
    MEMORY_REVISION_RULE,
    MEMORY_ACTION_CONTRACT
  ]

  const blocks: string[] = []
  for (const character of characters) {
    const memories = memoriesByChar.get(character.id) ?? []
    const lines = memories.length
      ? memories.map((m) => `[Memory id=${m.id} · ${m.type}] ${m.content}`).join('\n')
      : '(nothing remembered yet)'
    blocks.push(`### ${character.name} (character_id=${character.id})\n${lines}`)
  }
  parts.push('## Memories held today\n' + blocks.join('\n\n'))

  if (ledger.length) {
    const lines = ledger.map(
      (p) =>
        `[Proposal ${p.id} · ${p.actionType} · memory_id=${p.targetMemoryId} · ` +
        `${p.status}] for ${p.characterName}\n` +
        (p.currentContent ? `Currently: ${p.currentContent}\n` : '') +
        `Proposed: ${p.proposedContent || '(removal)'}`
    )
    parts.push(
      '## Proposals still awaiting the user\n' +
        'These are not canon yet. Their memory ids are real and stable: revise ' +
        'one with another replace rather than proposing the same thing again. ' +
        'A rejected proposal may be reworked.\n\n' +
        lines.join('\n\n')
    )
  }

  const user = `Scene: ${scene.title || '(untitled)'}\n\nTranscript:\n${transcript}`
  return [
    { role: 'system', content: parts.join('\n\n') },
    { role: 'user', content: user }
  ]
}

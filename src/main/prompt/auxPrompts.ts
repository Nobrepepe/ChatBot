/** One-shot prompts: summary, impersonation, continuation, memory suggestions. */

import type { Character, Message, Persona, Scene } from '@shared/types'
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
  const user = `Scene premise: ${scene.premise || '(none)'}\n\nTranscript:\n${transcript}`
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

export function buildMemorySuggestionPrompt(
  characters: Character[],
  scene: Scene,
  history: Message[]
): ChatMessage[] {
  const transcript = transcriptLines(characters, history).join('\n')
  const names = characters.map((c) => c.name).join(', ')
  const system =
    'You are a helpful writing assistant. Read the scene transcript and ' +
    'propose the most important facts worth remembering permanently about ' +
    `the character(s): ${names}. Focus on revelations, promises, decisions, ` +
    'relationship changes, and new canon details. Write ONLY a plain list, ' +
    "one fact per line, each line starting with '- '. Each fact must be a " +
    'single self-contained sentence naming the character it is about. ' +
    'Propose at most 6 facts. Do not invent anything not in the transcript.'
  const user = `Scene premise: ${scene.premise || '(none)'}\n\nTranscript:\n${transcript}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

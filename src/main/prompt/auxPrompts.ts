/** One-shot prompts: summary, impersonation, continuation, memory suggestions. */

import type { Character, Message, Persona, Scene } from '@shared/types'
import type { ChatMessage } from '../providers/openaiCompat'
import { systemText, type BuiltPrompt } from './promptBuilder'

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

export function buildImpersonationPrompt(
  context: BuiltPrompt,
  persona: Persona,
  draft = ''
): ChatMessage[] {
  const contextSections = context.sections.filter(
    (s) => s.label !== 'System instructions' && s.label !== 'Custom system prompt'
  )
  const background = systemText(contextSections)
  let system =
    'You are helping the user roleplay as their persona. Write one possible ' +
    `next turn for ${persona.name}, the USER persona—not for any character. ` +
    'Infer a natural response from the persona description, scene context, and ' +
    'conversation. Include what the persona says and, when natural, a brief ' +
    'action in roleplay prose. Never decide major irreversible actions for the ' +
    'user. Output only the suggested turn: no explanation, no speaker label, ' +
    'no quotation wrapper around the whole response, and no sprite call sign.'
  if (background) system += '\n\n' + background
  const messages: ChatMessage[] = [{ role: 'system', content: system }]
  messages.push(...context.messages.slice(1))
  let request = "Suggest the user persona's next turn now."
  if (draft.trim()) {
    request += ` Use this unfinished draft as optional guidance:\n${draft.trim()}`
  }
  messages.push({ role: 'user', content: request })
  return messages
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

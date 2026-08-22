/**
 * Builds the final prompt from world, characters, memories, scene, and history.
 * Every section is kept separately so the prompt debug panel can show exactly
 * what the model received. Faithful port of the Flet app's prompt_builder.py;
 * the difference is that history rows are structured (character_id + emotion
 * columns), so wire tags are re-added here at build time.
 */

import type {
  Character,
  LoreEntry,
  Memory,
  Message,
  Persona,
  Scene,
  SceneMode,
  World
} from '@shared/types'
import type { ChatMessage } from '../providers/openaiCompat'

export const MODE_INSTRUCTIONS: Record<SceneMode, string> = {
  roleplay:
    'This is an in-world roleplay. Respond as the character, in character at ' +
    'all times. Write dialogue in quotes and brief third-person narration for ' +
    "the character's actions when it helps the scene. Never speak or act for " +
    "the user. Do not reveal the character's secrets too easily. Ask " +
    'questions when natural. Keep replies to a few paragraphs at most.',
  interview:
    'This is an interview between the writer (the user) and the character. ' +
    'The character answers questions honestly from their own point of view, ' +
    'in their own voice, as if reflecting on themselves. Stay in character, ' +
    'but the character is aware this is a candid conversation, not a scene.',
  author:
    'This is an author-assistant conversation. You are a skilled writing ' +
    'assistant discussing the character and world WITH the user, not ' +
    'roleplaying. Analyze, critique, and suggest ideas about the character, ' +
    'referencing the profile, memories, and scene context provided.'
}

export const MULTI_CHARACTER_RULES =
  'Multiple characters are present in this scene. Rules:\n' +
  '- Only speak for the listed characters, never for the user.\n' +
  '- Exactly one character responds per assistant turn.\n' +
  "- Begin with that character's name in curly brackets, e.g. '{Daniela}'.\n" +
  "- Keep each character's voice distinct, following their profiles.\n" +
  '- When a next responder is explicitly selected, only that character responds.'

export const NARRATOR_INSTRUCTION =
  'You may also act as a scene narrator: between pieces of dialogue, write ' +
  'brief narration describing the surroundings, atmosphere, and the ' +
  "character's actions. Write all narration in italics using asterisks, " +
  '*like this*. Keep narration short and evocative; dialogue carries the scene.'

export const NO_NARRATOR_INSTRUCTION =
  'Do not write standalone scene narration paragraphs; stay with the ' +
  "character's dialogue and brief inline action beats."

/** sprites: bare call sign -> sprite name. Brackets are added here, on the wire. */
export function spriteInstruction(sprites: Record<string, string>, speakerName = ''): string {
  const entries = Object.entries(sprites)
  const choices = entries.map(([callSign, name]) => `[${callSign}] (${name})`).join(', ')
  const example = entries[0]?.[0] ?? 'neutral'
  const prefix = speakerName ? `Immediately after {${speakerName}}, put` : 'Begin every reply with'
  return (
    `${prefix} exactly one sprite call sign in square brackets, ` +
    `chosen from this list: ${choices}. Choose the sprite that best matches the ` +
    "character's current emotion or action. Follow the tag with the response " +
    `itself. Example: ${speakerName ? `{${speakerName}}` : ''}[${example}] "..."`
  )
}

export interface PromptSection {
  label: string
  content: string
}

export interface BuiltPrompt {
  sections: PromptSection[]
  messages: ChatMessage[]
}

export function systemText(sections: PromptSection[]): string {
  return sections
    .filter((s) => s.content.trim())
    .map((s) => `## ${s.label}\n${s.content}`)
    .join('\n\n')
}

function block(...pairs: [string, string][]): string {
  const lines: string[] = []
  for (const [label, raw] of pairs) {
    const value = (raw || '').trim()
    if (value) lines.push(value.includes('\n') ? `${label}:\n${value}` : `${label}: ${value}`)
  }
  return lines.join('\n')
}

export function buildWorldSection(world: World): string {
  return block(
    ['World name', world.name],
    ['Genre', world.genre],
    ['Tone', world.tone],
    ['Summary', world.summary],
    ['Setting description', world.settingDescription],
    ['Style guide', world.styleGuide]
  )
}

export function buildCharacterSection(char: Character): string {
  return block(
    ['Name', char.name],
    ['Nicknames', char.nicknames],
    ['Age', char.age],
    ['Role/archetype', char.role],
    ['Summary', char.summary],
    ['Appearance', char.appearance],
    ['Personality', char.personality],
    ['Backstory', char.backstory],
    ['Behavior rules', char.behaviorRules],
    ['Voice and dialogue style', char.voiceStyle],
    ['Relationship to the user', char.relationshipToUser],
    ['Extra AI instructions', char.aiInstructions]
  )
}

export function buildMemorySection(characterName: string, memories: Memory[]): string {
  const canon = memories.filter((m) => m.type === 'canon').map((m) => m.content)
  const relationship = memories.filter((m) => m.type === 'relationship').map((m) => m.content)
  const parts: string[] = []
  if (canon.length) {
    parts.push(
      `Canon facts about ${characterName} (established and permanently true):\n` +
        canon.map((c) => `- ${c}`).join('\n')
    )
  }
  if (relationship.length) {
    parts.push(
      `How ${characterName} currently feels about the user:\n` +
        relationship.map((r) => `- ${r}`).join('\n')
    )
  }
  return parts.join('\n\n')
}

export function buildSceneSection(scene: Scene): string {
  return block(
    ['Scene premise', scene.premise],
    ['Time of day', scene.timeOfDay],
    ['Tone', scene.tone],
    ['Current relationship status', scene.relationshipStatus]
  )
}

export type LoreMatch = { entry: LoreEntry; reason: string }

/** Always-include entries plus entries whose keywords appear in the premise,
 * title, or the last `recent` visible messages. Plain substring matching. */
export function matchLore(
  entries: LoreEntry[],
  scene: Scene,
  history: Message[],
  recent = 10
): LoreMatch[] {
  const visible = history.filter((m) => !m.deletedAt && m.role !== 'system-note')
  const haystack = [scene.premise, scene.title, ...visible.slice(-recent).map((m) => m.content)]
    .join(' ')
    .toLowerCase()

  const matches: LoreMatch[] = []
  for (const entry of entries) {
    if (entry.alwaysInclude) {
      matches.push({ entry, reason: 'always included' })
      continue
    }
    for (const raw of entry.keywords) {
      const kw = raw.trim().toLowerCase()
      if (kw && haystack.includes(kw)) {
        matches.push({ entry, reason: `matched keyword "${kw}"` })
        break
      }
    }
  }
  return matches
}

export interface BuildPromptInput {
  world: World
  characters: Character[]
  scene: Scene
  memoriesByChar: Map<number, Memory[]>
  loreMatches: LoreMatch[]
  persona: Persona | null
  history: Message[]
  historyLimit?: number
  emotionTags?: boolean
  /** bare call sign -> sprite name, for the active responder */
  sprites?: Record<string, string> | null
  responder?: Character | null
  respondToLatest?: boolean
  systemPrompt?: string
}

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const {
    world,
    characters,
    scene,
    memoriesByChar,
    loreMatches,
    persona,
    history,
    historyLimit = 30,
    emotionTags = false,
    sprites = null,
    responder = null,
    respondToLatest = false,
    systemPrompt = ''
  } = input

  const sections: PromptSection[] = []
  const multi = characters.length > 1
  const mode: SceneMode = scene.mode in MODE_INSTRUCTIONS ? scene.mode : 'roleplay'

  if (systemPrompt.trim()) {
    sections.push({ label: 'Custom system prompt', content: systemPrompt.trim() })
  }

  const names = characters.map((c) => `"${c.name}"`).join(', ')
  const coreParts = [
    `You are playing the character${multi ? 's' : ''} ${names} in the ` +
      `world "${world.name}".\n${MODE_INSTRUCTIONS[mode]}`
  ]
  if (multi) {
    coreParts.push(MULTI_CHARACTER_RULES)
    if (responder) {
      coreParts.push(
        `For the next reply, only "${responder.name}" may respond. Begin the ` +
          `reply with {${responder.name}}, followed by the emotion tag.`
      )
      if (respondToLatest) {
        coreParts.push(
          `"${responder.name}" must respond directly and naturally to the ` +
            'latest assistant reply. Continue the exchange without waiting ' +
            'for or inventing a user message.'
        )
      }
    }
  }
  if (mode === 'roleplay') {
    coreParts.push(scene.narratorEnabled ? NARRATOR_INSTRUCTION : NO_NARRATOR_INSTRUCTION)
  }
  if (emotionTags && sprites && Object.keys(sprites).length && mode !== 'author') {
    coreParts.push(spriteInstruction(sprites, multi && responder ? responder.name : ''))
  }
  sections.push({ label: 'System instructions', content: coreParts.join('\n\n') })

  sections.push({ label: 'World', content: buildWorldSection(world) })

  for (const char of characters) {
    const label = multi ? `Character profile: ${char.name}` : 'Character profile'
    sections.push({ label, content: buildCharacterSection(char) })
  }

  for (const char of characters) {
    const memText = buildMemorySection(char.name, memoriesByChar.get(char.id) ?? [])
    if (memText) {
      sections.push({ label: multi ? `Memories: ${char.name}` : 'Memories', content: memText })
    }
  }

  if (loreMatches.length) {
    sections.push({
      label: 'Relevant lore',
      content: loreMatches
        .map(({ entry, reason }) => `### ${entry.title} (${reason})\n${entry.content}`)
        .join('\n\n')
    })
  }

  if (persona) {
    sections.push({
      label: 'User persona',
      content: `In this scene the user is: ${persona.name}\n${persona.description}`.trim()
    })
  }

  sections.push({ label: 'Scene', content: buildSceneSection(scene) })

  const visible = history.filter((m) => !m.deletedAt && m.role !== 'system-note')
  const truncated = visible.length > historyLimit
  const window = truncated ? visible.slice(-historyLimit) : visible

  if (truncated && scene.summary.trim()) {
    sections.push({ label: 'Earlier in this scene (summary)', content: scene.summary.trim() })
  }

  const nameById = new Map(characters.map((c) => [c.id, c.name]))
  const messages: ChatMessage[] = [{ role: 'system', content: systemText(sections) }]
  for (const msg of window) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content })
    } else {
      // Character and narrator replies both come from the assistant. Wire tags
      // are reconstructed from the structured columns.
      let content = msg.content
      if (emotionTags && msg.emotion) content = `[${msg.emotion}] ${content}`
      if (multi && msg.role === 'character' && msg.characterId != null) {
        const name = nameById.get(msg.characterId)
        if (name) content = `{${name}} ${content}`
      }
      messages.push({ role: 'assistant', content })
    }
  }
  return { sections, messages }
}

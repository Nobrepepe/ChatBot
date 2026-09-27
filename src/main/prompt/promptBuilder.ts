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

/**
 * More than one voice can speak, so every turn says whose it is. That is true
 * of a scene with several characters and equally true of a scene with one
 * character and an extra, so the rules are written for voices rather than for
 * profiles.
 */
export const LABELLED_TURN_RULES =
  'More than one voice can speak in this scene. Rules:\n' +
  '- Only speak for the listed characters, never for the user.\n' +
  '- Exactly one voice responds per assistant turn.\n' +
  "- Begin with that voice's name in curly brackets, e.g. '{Daniela}'.\n" +
  "- Keep each character's voice distinct, following their profiles.\n" +
  '- When a next responder is explicitly selected, only that voice responds.'

/**
 * Named once the scene has actually produced an extra, so the transcript the
 * model is reading stops containing labels the rules above say cannot exist.
 */
export function extrasRule(names: string[]): string {
  return (
    'The scene also has extras: people it has put within earshot who have no ' +
    `profile. So far: ${names.map((n) => `"${n}"`).join(', ')}. Their turns are ` +
    'labelled the same way. Do not write an extra unless a turn explicitly ' +
    'asks for one.'
  )
}

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
  return block(['Scene title', scene.title], ['Previously', scene.previouslyOn])
}

export type LoreMatch = { entry: LoreEntry; reason: string }

/** Characters of lore text one prompt may carry before entries are trimmed. */
export const DEFAULT_LORE_BUDGET = 6000

/**
 * Lore is injected whole, so a single long document can crowd out everything
 * else — a 70 KB setting document is ~18k tokens on its own, sent again with
 * every message. Entries are taken in order, always-include ones first, until
 * the budget runs out. The entry that straddles the line is trimmed rather
 * than dropped, because a document's opening is usually its summary, and
 * whatever did not fit is named so the model knows it exists and the prompt
 * debug panel shows what happened. A budget of 0 keeps everything.
 */
export function budgetLore(matches: LoreMatch[], budget: number): PromptSection | null {
  if (!matches.length) return null
  const unlimited = !Number.isFinite(budget) || budget <= 0
  const ordered = [
    ...matches.filter((m) => m.entry.alwaysInclude),
    ...matches.filter((m) => !m.entry.alwaysInclude)
  ]

  const parts: string[] = []
  const omitted: string[] = []
  let left = budget
  for (const { entry, reason } of ordered) {
    const head = `### ${entry.title} (${reason})`
    const body = entry.content.trim()
    if (unlimited || body.length <= left) {
      parts.push(`${head}\n${body}`)
      left -= body.length
      continue
    }
    if (left <= 0) {
      omitted.push(entry.title)
      continue
    }
    parts.push(`${head}\n${body.slice(0, left).trimEnd()}\n…(trimmed to fit the lore budget)`)
    left = 0
  }
  if (omitted.length) {
    parts.push(`Left out to stay within the lore budget: ${omitted.join(', ')}.`)
  }
  return { label: 'Relevant lore', content: parts.join('\n\n') }
}

/** Always-include entries plus entries whose keywords appear in the premise,
 * title, or the last `recent` visible messages. Plain substring matching. */
export function matchLore(
  entries: LoreEntry[],
  scene: Scene,
  history: Message[],
  recent = 10
): LoreMatch[] {
  const visible = history.filter((m) => !m.deletedAt && m.role !== 'system-note')
  const haystack = [scene.title, scene.previouslyOn, ...visible.slice(-recent).map((m) => m.content)]
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
  /**
   * The cast member the prompt is written around. Deliberately a Character and
   * never an extra: asking for an extra must not touch the system section, or
   * a local server loses its prefix cache and reprocesses the whole context
   * every time the scene calls on someone. Extras are steered entirely by the
   * trailing turn-control message the caller appends. The one thing that does
   * change this section is an extra already standing in the history — a
   * property of the scene, not of this turn, so it settles once and stays.
   */
  responder?: Character | null
  respondToLatest?: boolean
  systemPrompt?: string
  /** Characters of lore text to allow; 0 keeps every matched entry. */
  loreBudget?: number
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
    systemPrompt = '',
    loreBudget = DEFAULT_LORE_BUDGET
  } = input

  const sections: PromptSection[] = []
  const multi = characters.length > 1
  const mode: SceneMode = scene.mode in MODE_INSTRUCTIONS ? scene.mode : 'roleplay'

  const visible = history.filter((m) => !m.deletedAt && m.role !== 'system-note')
  const truncated = visible.length > historyLimit
  const window = truncated ? visible.slice(-historyLimit) : visible

  // The extras the model can still see. Derived from the window rather than the
  // whole scene: an extra who has fallen out of the history is not in the room
  // any more, and naming them would invite the model to bring them back.
  const extraNames = [
    ...new Set(
      window.filter((m) => m.role === 'extra' && m.speakerName).map((m) => m.speakerName)
    )
  ]

  // Turns carry a name whenever more than one voice can speak — several
  // characters, or one character and an extra.
  const labelTurns = multi || extraNames.length > 0

  if (systemPrompt.trim()) {
    sections.push({ label: 'Custom system prompt', content: systemPrompt.trim() })
  }

  const names = characters.map((c) => `"${c.name}"`).join(', ')
  const coreParts = [
    `You are playing the character${multi ? 's' : ''} ${names} in the ` +
      `world "${world.name}".\n${MODE_INSTRUCTIONS[mode]}`
  ]
  if (labelTurns) {
    coreParts.push(LABELLED_TURN_RULES)
    if (extraNames.length) coreParts.push(extrasRule(extraNames))
    if (multi && responder) {
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
    coreParts.push(spriteInstruction(sprites, labelTurns && responder ? responder.name : ''))
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

  const loreSection = budgetLore(loreMatches, loreBudget)
  if (loreSection) sections.push(loreSection)

  if (persona) {
    sections.push({
      label: 'User persona',
      content: `In this scene the user is: ${persona.name}\n${persona.description}`.trim()
    })
  }

  sections.push({ label: 'Scene', content: buildSceneSection(scene) })

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
      if (labelTurns && msg.role === 'character' && msg.characterId != null) {
        const name = nameById.get(msg.characterId)
        if (name) content = `{${name}} ${content}`
      }
      if (labelTurns && msg.role === 'extra' && msg.speakerName) {
        content = `{${msg.speakerName}} ${content}`
      }
      messages.push({ role: 'assistant', content })
    }
  }
  return { sections, messages }
}

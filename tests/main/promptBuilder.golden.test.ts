import { describe, it, expect } from 'vitest'
import {
  buildPrompt,
  budgetLore,
  matchLore,
  spriteInstruction,
  MULTI_CHARACTER_RULES,
  NARRATOR_INSTRUCTION,
  NO_NARRATOR_INSTRUCTION,
  type LoreMatch
} from '@main/prompt/promptBuilder'
import type { Character, LoreEntry, Memory, Message, Persona, Scene, World } from '@shared/types'

// ---- fixtures ----

const world: World = {
  id: 1,
  name: 'Eden Castle',
  genre: 'Gothic fantasy',
  tone: 'Melancholy',
  summary: 'A castle that remembers its dead.',
  settingDescription: 'Endless corridors.\nPortraits that watch.',
  styleGuide: 'Slow, sensory prose.',
  coverImagePath: '',
  sessionBackgroundPath: '',
  hubId: null,
  publicationId: null,
  retiredAt: null,
  createdAt: '',
  updatedAt: ''
}

function makeCharacter(id: number, name: string, extra: Partial<Character> = {}): Character {
  return {
    id,
    worldId: 1,
    name,
    nicknames: '',
    age: '',
    role: '',
    summary: `${name} in one line.`,
    appearance: '',
    personality: `${name} is wry.`,
    backstory: '',
    behaviorRules: '',
    voiceStyle: '',
    relationshipToUser: '',
    aiInstructions: '',
    portraitPath: '',
    tileImagePath: '',
    hubId: null,
    publicationId: null,
    retiredAt: null,
    createdAt: '',
    updatedAt: '',
    ...extra
  }
}

const lirael = makeCharacter(11, 'Lirael')
const morgana = makeCharacter(12, 'Morgana')

function makeScene(extra: Partial<Scene> = {}): Scene {
  return {
    id: 5,
    worldId: 1,
    locationId: null,
    title: 'The rooftop',
    previouslyOn: 'They parted badly on the pier.',
    mode: 'roleplay',
    summary: '',
    narratorEnabled: false,
    personaId: null,
    publicationId: null,
    displayMode: null,
    characterIds: [11],
    autoSummaryAt: 0,
    autoMemoriesAt: 0,
    createdAt: '',
    updatedAt: ''
  , ...extra }
}

let nextMessageId = 1
function msg(role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return {
    id: nextMessageId++,
    sceneId: 5,
    role,
    characterId: role === 'character' ? 11 : null,
    content,
    emotion: '',
    deletedAt: null,
    createdAt: '',
    ...extra
  }
}

const persona: Persona = { id: 3, name: 'Rui', description: 'A traveling scribe.', createdAt: '' }

function memory(characterId: number, type: Memory['type'], content: string): Memory {
  return {
    id: 0,
    characterId,
    type,
    content,
    sourceSceneId: null,
    lifecycleStatus: 'canonical',
    createdAt: ''
  }
}

function lore(id: number, title: string, keywords: string[], alwaysInclude = false): LoreEntry {
  return {
    id,
    worldId: 1,
    title,
    content: `Lore about ${title}.`,
    keywords,
    alwaysInclude,
    hubId: null,
    publicationId: null,
    createdAt: '',
    updatedAt: ''
  }
}

const base = {
  world,
  characters: [lirael],
  scene: makeScene(),
  memoriesByChar: new Map<number, Memory[]>(),
  loreMatches: [],
  persona: null,
  history: [] as Message[]
}

// ---- golden snapshots ----

describe('buildPrompt', () => {
  it('single character roleplay without narrator', () => {
    const built = buildPrompt({ ...base, history: [msg('user', 'Hello?')] })
    expect(built.messages).toMatchSnapshot()
    expect(built.messages[0]!.content).toContain(NO_NARRATOR_INSTRUCTION)
    expect(built.messages[0]!.content).not.toContain(MULTI_CHARACTER_RULES)
  })

  it('multi-character with responder lock and respond-to-latest', () => {
    const built = buildPrompt({
      ...base,
      characters: [lirael, morgana],
      scene: makeScene({ narratorEnabled: true, characterIds: [11, 12] }),
      responder: morgana,
      respondToLatest: true,
      history: [
        msg('user', 'Who goes first?'),
        msg('character', 'I heard something below.', { characterId: 11 })
      ]
    })
    const system = built.messages[0]!.content
    expect(system).toContain(MULTI_CHARACTER_RULES)
    expect(system).toContain('only "Morgana" may respond')
    expect(system).toContain('must respond directly and naturally to the latest assistant reply')
    expect(system).toContain(NARRATOR_INSTRUCTION)
    // History reconstructs the {Name} wire prefix from character_id.
    expect(built.messages[2]!.content).toBe('{Lirael} I heard something below.')
    expect(built.messages).toMatchSnapshot()
  })

  it('interview mode swaps the mode instruction', () => {
    const built = buildPrompt({ ...base, scene: makeScene({ mode: 'interview' }) })
    expect(built.messages[0]!.content).toContain('This is an interview')
    expect(built.messages[0]!.content).not.toContain(NO_NARRATOR_INSTRUCTION)
  })

  it('author mode never gets a sprite instruction', () => {
    const built = buildPrompt({
      ...base,
      scene: makeScene({ mode: 'author' }),
      emotionTags: true,
      sprites: { sad: 'Sad' }
    })
    expect(built.messages[0]!.content).not.toContain('sprite call sign')
  })

  it('adds the sprite instruction and re-prefixes emotions in history', () => {
    const built = buildPrompt({
      ...base,
      emotionTags: true,
      sprites: { neutral: 'Main portrait', sad: 'Sad' },
      history: [
        msg('user', 'Are you alright?'),
        msg('character', 'Not really.', { emotion: 'sad' })
      ]
    })
    const system = built.messages[0]!.content
    expect(system).toContain('Begin every reply with exactly one sprite call sign')
    expect(system).toContain('[neutral] (Main portrait), [sad] (Sad)')
    expect(built.messages[2]!.content).toBe('[sad] Not really.')
    expect(built.messages).toMatchSnapshot()
  })

  it('names the responder in the sprite instruction for multi-character scenes', () => {
    const built = buildPrompt({
      ...base,
      characters: [lirael, morgana],
      responder: morgana,
      emotionTags: true,
      sprites: { smile: 'Smiling' }
    })
    expect(built.messages[0]!.content).toContain('Immediately after {Morgana}, put')
  })

  it('includes memories, lore and persona sections', () => {
    const built = buildPrompt({
      ...base,
      memoriesByChar: new Map([
        [11, [memory(11, 'canon', 'Lirael cannot swim.'), memory(11, 'relationship', 'She trusts you now.')]]
      ]),
      loreMatches: [
        { entry: lore(1, 'The Accord', [], true), reason: 'always included' },
        { entry: lore(2, 'The Storm Bell', ['storm']), reason: 'matched keyword "storm"' }
      ],
      persona
    })
    const system = built.messages[0]!.content
    expect(system).toContain('Canon facts about Lirael (established and permanently true):\n- Lirael cannot swim.')
    expect(system).toContain('How Lirael currently feels about the user:\n- She trusts you now.')
    expect(system).toContain('### The Accord (always included)')
    expect(system).toContain('### The Storm Bell (matched keyword "storm")')
    expect(system).toContain('In this scene the user is: Rui\nA traveling scribe.')
    expect(built.messages).toMatchSnapshot()
  })

  it('truncates history to the window and adds the summary section only then', () => {
    const history = Array.from({ length: 8 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'character', `Line ${i + 1}`)
    )
    const withSummary = makeScene({ summary: 'Earlier, promises were made.' })

    const truncated = buildPrompt({ ...base, scene: withSummary, history, historyLimit: 4 })
    expect(truncated.messages).toHaveLength(1 + 4)
    expect(truncated.messages[0]!.content).toContain('## Earlier in this scene (summary)\nEarlier, promises were made.')
    expect(truncated.messages[1]!.content).toBe('Line 5')

    const untruncated = buildPrompt({ ...base, scene: withSummary, history, historyLimit: 30 })
    expect(untruncated.messages[0]!.content).not.toContain('Earlier in this scene')
  })

  it('drops deleted and system-note messages from history and lore matching', () => {
    const history = [
      msg('user', 'kept'),
      msg('user', 'gone', { deletedAt: '2026-01-01' }),
      msg('system-note', 'internal')
    ]
    const built = buildPrompt({ ...base, history })
    expect(built.messages).toHaveLength(2)
    expect(built.messages[1]!.content).toBe('kept')
  })

  it('puts the custom system prompt first', () => {
    const built = buildPrompt({ ...base, systemPrompt: 'Always answer in Portuguese.' })
    expect(built.sections[0]).toEqual({
      label: 'Custom system prompt',
      content: 'Always answer in Portuguese.'
    })
  })
})

describe('budgetLore', () => {
  const long = (title: string, size: number, always = false): LoreMatch => ({
    entry: { ...lore(1, title, [], always), content: 'x'.repeat(size) },
    reason: always ? 'always included' : 'matched keyword "x"'
  })

  it('keeps everything that fits', () => {
    const section = budgetLore([long('Short', 100), long('Also short', 100)], 6000)!
    expect(section.content).toContain('### Short')
    expect(section.content).toContain('### Also short')
    expect(section.content).not.toContain('trimmed')
  })

  it('trims the entry that straddles the line instead of dropping it whole', () => {
    const section = budgetLore([long('Setting document', 70_000)], 6000)!
    expect(section.content).toContain('### Setting document')
    expect(section.content).toContain('…(trimmed to fit the lore budget)')
    expect(section.content.length).toBeLessThan(6200)
  })

  it('names what it left out so the model knows the entry exists', () => {
    const section = budgetLore([long('Hoarder', 6000), long('Crowded out', 500)], 6000)!
    expect(section.content).toContain('Left out to stay within the lore budget: Crowded out.')
  })

  it('spends the budget on always-include entries before keyword matches', () => {
    const section = budgetLore([long('Keyword hit', 6000), long('Mandatory', 100, true)], 6000)!
    expect(section.content).toContain('### Mandatory')
    expect(section.content.indexOf('### Mandatory')).toBeLessThan(
      section.content.indexOf('### Keyword hit')
    )
  })

  it('keeps every match when the budget is 0', () => {
    const section = budgetLore([long('Setting document', 70_000)], 0)!
    expect(section.content).not.toContain('trimmed')
    expect(section.content.length).toBeGreaterThan(70_000)
  })

  it('has no section to add when nothing matched', () => {
    expect(budgetLore([], 6000)).toBeNull()
  })
})

describe('matchLore', () => {
  const entries = [
    lore(1, 'Always-on', [], true),
    lore(2, 'Bell', ['storm bell', 'chime']),
    lore(3, 'Unmatched', ['dragon'])
  ]

  it('matches always-include, keyword-in-title and keyword-in-history', () => {
    const scene = makeScene({ title: 'The storm bell rings.' })
    const matches = matchLore(entries, scene, [])
    expect(matches.map((m) => m.entry.id)).toEqual([1, 2])
    expect(matches[1]!.reason).toBe('matched keyword "storm bell"')
  })

  it('searches only the recent window and skips deleted messages', () => {
    const scene = makeScene({ previouslyOn: '', title: '' })
    const old = msg('user', 'a chime sounds')
    const recent = Array.from({ length: 10 }, () => msg('user', 'nothing'))
    expect(matchLore(entries, scene, [old, ...recent]).map((m) => m.entry.id)).toEqual([1])

    const deleted = msg('user', 'a chime sounds', { deletedAt: 'x' })
    expect(matchLore(entries, scene, [deleted]).map((m) => m.entry.id)).toEqual([1])
    expect(matchLore(entries, scene, [msg('user', 'a chime sounds')]).map((m) => m.entry.id)).toEqual([1, 2])
  })
})

describe('spriteInstruction', () => {
  it('formats bare call signs with brackets on the wire', () => {
    const text = spriteInstruction({ sad: 'Sad', 'sword-attack': 'Sword attack' })
    expect(text).toContain('[sad] (Sad), [sword-attack] (Sword attack)')
    expect(text).toContain('Example: [sad] "..."')
  })
})

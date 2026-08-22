import { describe, it, expect } from 'vitest'
import {
  buildContinuationPrompt,
  buildImpersonationPrompt,
  buildMemorySuggestionPrompt,
  buildSummaryPrompt,
  CONTINUE_INSTRUCTION
} from '@main/prompt/auxPrompts'
import type { BuiltPrompt } from '@main/prompt/promptBuilder'
import type { Character, Message, Persona, Scene } from '@shared/types'

const lirael = { id: 11, name: 'Lirael' } as Character
const morgana = { id: 12, name: 'Morgana' } as Character
const scene = { premise: 'A storm.', mode: 'roleplay' } as Scene
const persona: Persona = { id: 1, name: 'Rui', description: 'A scribe.', createdAt: '' }

let id = 0
function msg(role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return {
    id: ++id,
    sceneId: 1,
    role,
    characterId: role === 'character' ? 11 : null,
    content,
    emotion: '',
    deletedAt: null,
    createdAt: '',
    ...extra
  }
}

const history = [
  msg('user', 'Hello?'),
  msg('character', '"Who is there?"'),
  msg('character', '"Show yourself."', { characterId: 12 }),
  msg('narrator', '*Wind rises.*'),
  msg('user', 'deleted line', { deletedAt: 'x' })
]

describe('buildSummaryPrompt', () => {
  it('labels speakers from structured columns and skips deleted messages', () => {
    const messages = buildSummaryPrompt([lirael, morgana], scene, history)
    expect(messages[0]!.content).toContain('Summarize the scene transcript')
    const transcript = messages[1]!.content
    expect(transcript).toContain('User: Hello?')
    expect(transcript).toContain('Lirael: "Who is there?"')
    expect(transcript).toContain('Morgana: "Show yourself."')
    expect(transcript).toContain('*Wind rises.*')
    expect(transcript).not.toContain('deleted line')
  })
})

describe('buildImpersonationPrompt', () => {
  const context: BuiltPrompt = {
    sections: [
      { label: 'Custom system prompt', content: 'secret global prompt' },
      { label: 'System instructions', content: 'roleplay instructions' },
      { label: 'World', content: 'World name: Eden' },
      { label: 'Scene', content: 'Scene premise: A storm.' }
    ],
    messages: [
      { role: 'system', content: 'full system' },
      { role: 'user', content: 'Hello?' },
      { role: 'assistant', content: '"Who is there?"' }
    ]
  }

  it('reuses context minus the system-instruction sections and replays history', () => {
    const messages = buildImpersonationPrompt(context, persona, ' half-typed ')
    const system = messages[0]!.content
    expect(system).toContain('next turn for Rui, the USER persona')
    expect(system).toContain('## World\nWorld name: Eden')
    expect(system).not.toContain('roleplay instructions')
    expect(system).not.toContain('secret global prompt')
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello?' })
    expect(messages.at(-1)!.content).toContain('optional guidance:\nhalf-typed')
  })
})

describe('buildContinuationPrompt', () => {
  it('appends the partial as an assistant turn plus the OOC instruction', () => {
    const context: BuiltPrompt = {
      sections: [],
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'go on' }
      ]
    }
    const messages = buildContinuationPrompt(context, 'She opened the do')
    expect(messages.at(-2)).toEqual({ role: 'assistant', content: 'She opened the do' })
    expect(messages.at(-1)).toEqual({ role: 'user', content: CONTINUE_INSTRUCTION })
  })
})

describe('buildMemorySuggestionPrompt', () => {
  it('asks for at most six self-contained bullet facts', () => {
    const messages = buildMemorySuggestionPrompt([lirael, morgana], scene, history)
    expect(messages[0]!.content).toContain('propose the most important facts')
    expect(messages[0]!.content).toContain('Lirael, Morgana')
    expect(messages[0]!.content).toContain('at most 6 facts')
  })
})

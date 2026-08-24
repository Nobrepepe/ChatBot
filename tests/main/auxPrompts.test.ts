import { describe, it, expect } from 'vitest'
import {
  buildContinuationPrompt,
  buildImpersonationPrompt,
  buildMemorySuggestionPrompt,
  buildSummaryPrompt,
  CONTINUE_INSTRUCTION
} from '@main/prompt/auxPrompts'
import type { BuiltPrompt } from '@main/prompt/promptBuilder'
import type { Character, Memory, MemoryProposal, Message, Persona, Scene } from '@shared/types'

const lirael = { id: 11, name: 'Lirael' } as Character
const morgana = { id: 12, name: 'Morgana' } as Character
const scene = { title: 'A storm.', mode: 'roleplay' } as Scene
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

  it('leaves the reply prompt untouched so the server keeps its prefix cache', () => {
    const messages = buildImpersonationPrompt(context, persona)
    // Byte-for-byte the reply prompt: anything else changes token zero and
    // costs a full reprocess of the context on every suggestion.
    expect(messages.slice(0, context.messages.length)).toEqual(context.messages)
    expect(messages).toHaveLength(context.messages.length + 1)
  })

  it('steers to the persona with a trailing OOC turn', () => {
    const messages = buildImpersonationPrompt(context, persona)
    const request = messages.at(-1)!
    expect(request.role).toBe('user')
    expect(request.content).toContain('next turn for Rui, the USER persona')
    expect(request.content).toContain('no sprite call sign')
  })

  it('passes an unfinished draft along, trimmed, as optional guidance', () => {
    const messages = buildImpersonationPrompt(context, persona, ' half-typed ')
    expect(messages.at(-1)!.content).toContain('optional guidance:\nhalf-typed')
  })

  it('says nothing about a draft when the composer is empty', () => {
    expect(buildImpersonationPrompt(context, persona, '   ').at(-1)!.content).not.toContain(
      'Unfinished draft'
    )
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
  function memory(id: number, characterId: number, type: Memory['type'], content: string): Memory {
    return { id, characterId, type, content, sourceSceneId: null, lifecycleStatus: 'canonical', createdAt: '' }
  }

  const base = {
    characters: [lirael, morgana],
    scene,
    history,
    memoriesByChar: new Map([
      [11, [memory(7, 11, 'relationship', 'Lirael barely tolerates the user.')]],
      [12, []]
    ]),
    ledger: [] as MemoryProposal[]
  }

  it('names each character with the id an action must use', () => {
    const system = buildMemorySuggestionPrompt(base)[0]!.content
    expect(system).toContain('Lirael (character_id=11)')
    expect(system).toContain('Morgana (character_id=12)')
  })

  it('lists what is remembered today with stable ids', () => {
    const system = buildMemorySuggestionPrompt(base)[0]!.content
    expect(system).toContain('[Memory id=7 · relationship] Lirael barely tolerates the user.')
    expect(system).toContain('(nothing remembered yet)')
  })

  it('asks for a rewrite rather than a second, contradicting memory', () => {
    const system = buildMemorySuggestionPrompt(base)[0]!.content
    expect(system).toContain('REPLACE it rather than creating a second memory')
    expect(system).toContain('memory_action')
    expect(system).toContain('at most six actions')
  })

  it('shows proposals still awaiting the user so a second pass revises them', () => {
    const system = buildMemorySuggestionPrompt({
      ...base,
      ledger: [
        {
          id: 3,
          sceneId: 1,
          characterId: 11,
          characterName: 'Lirael',
          actionType: 'replace',
          targetMemoryId: 7,
          payload: {},
          status: 'pending',
          lifecycleStatus: 'canonical',
          currentContent: 'Lirael barely tolerates the user.',
          proposedContent: 'Lirael trusts the user now.',
          memoryType: 'relationship',
          createdAt: ''
        }
      ]
    })[0]!.content
    expect(system).toContain('[Proposal 3 · replace · memory_id=7 · pending] for Lirael')
    expect(system).toContain('Proposed: Lirael trusts the user now.')
    expect(system).toContain('not canon yet')
  })

  it('carries the transcript with the scene it came from', () => {
    const user = buildMemorySuggestionPrompt(base)[1]!.content
    expect(user).toContain('Scene: A storm.')
    expect(user).toContain('Lirael: "Who is there?"')
    expect(user).not.toContain('deleted line')
  })
})

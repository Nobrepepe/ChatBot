import { describe, it, expect } from 'vitest'
import { parseMemoryActions, parseMemoryBullets } from '@main/services/memoriesService'
import type { Character } from '@shared/types'

const lirael = { id: 11, name: 'Lirael' } as Character
const morgana = { id: 12, name: 'Morgana' } as Character

const context = {
  memoryIds: new Set([7, 8]),
  ownerOf: new Map([
    [7, 11],
    [8, 12]
  ]),
  characters: [lirael, morgana]
}

const fence = (payload: unknown): string =>
  '```memory_action\n' + JSON.stringify(payload) + '\n```'

describe('parseMemoryActions', () => {
  it('reads a create and attributes it to a named character', () => {
    const text =
      'Something changed.\n\n' +
      fence({ type: 'create', character_id: 12, memory_type: 'canon', content: 'She was afraid.' })
    const { visibleText, actions } = parseMemoryActions(text, context)
    expect(visibleText).toBe('Something changed.')
    expect(actions).toEqual([
      {
        actionType: 'create',
        targetMemoryId: null,
        characterId: 12,
        payload: { type: 'create', character_id: 12, memory_type: 'canon', content: 'She was afraid.' }
      }
    ])
  })

  it('reads a replace and takes the owner from the memory, not the model', () => {
    const { actions } = parseMemoryActions(
      fence({ type: 'replace', memory_id: 8, memory_type: 'relationship', content: 'She trusts you.' }),
      context
    )
    expect(actions[0]).toMatchObject({ actionType: 'replace', targetMemoryId: 8, characterId: 12 })
  })

  it('reads a forget without asking for content', () => {
    const { actions } = parseMemoryActions(
      fence({ type: 'forget', memory_id: 7, reason: 'She learned to swim.' }),
      context
    )
    expect(actions[0]).toMatchObject({ actionType: 'forget', targetMemoryId: 7, characterId: 11 })
  })

  it('takes several actions from one answer', () => {
    const text =
      fence({ type: 'forget', memory_id: 7, reason: 'stale' }) +
      '\n\n' +
      fence({ type: 'replace', memory_id: 8, content: 'Newer.' })
    expect(parseMemoryActions(text, context).actions).toHaveLength(2)
  })

  it('leaves an unusable block visible instead of swallowing it', () => {
    for (const bad of [
      { type: 'replace', memory_id: 999, content: 'Invented.' },
      { type: 'replace', memory_id: 7 },
      { type: 'create', character_id: 99, content: 'Nobody.' },
      { type: 'rewrite', memory_id: 7, content: 'Unsupported.' }
    ]) {
      const text = `A note.\n\n${fence(bad)}`
      const result = parseMemoryActions(text, context)
      expect(result.actions).toEqual([])
      expect(result.visibleText).toContain('memory_action')
    }
  })

  it('falls back to the only character when the model names none', () => {
    const { actions } = parseMemoryActions(
      fence({ type: 'create', memory_type: 'canon', content: 'She was afraid.' }),
      { ...context, characters: [lirael] }
    )
    expect(actions[0]).toMatchObject({ characterId: 11 })
  })

  it('defaults an unknown memory type to canon rather than rejecting the action', () => {
    const { actions } = parseMemoryActions(
      fence({ type: 'create', character_id: 11, memory_type: 'gossip', content: 'Something.' }),
      context
    )
    expect(actions[0]!.payload['memory_type']).toBe('canon')
  })

  it('accepts a bare object and a bare array, as the notes parser does', () => {
    const bare = '{"type":"forget","memory_id":7,"reason":"stale"}'
    expect(parseMemoryActions(bare, context).actions).toHaveLength(1)
    const array = '[{"type":"forget","memory_id":7},{"type":"replace","memory_id":8,"content":"x"}]'
    expect(parseMemoryActions(array, context).actions).toHaveLength(2)
  })

  it('rejects a whole block when one action in it is bad', () => {
    const array = '[{"type":"forget","memory_id":7},{"type":"replace","memory_id":999,"content":"x"}]'
    expect(parseMemoryActions(array, context).actions).toEqual([])
  })
})

describe('parseMemoryBullets', () => {
  it('reads the old plain list as creates, attributed by name', () => {
    const actions = parseMemoryBullets(
      '- Morgana admitted she was afraid.\n* Lirael keeps the rooftop key.\n1. Someone spoke.\nnot a bullet',
      [lirael, morgana]
    )
    expect(actions).toHaveLength(3)
    expect(actions[0]).toMatchObject({ actionType: 'create', characterId: 12 })
    expect(actions[1]).toMatchObject({ characterId: 11 })
    // No name in the line: it goes to the first of the cast rather than nowhere.
    expect(actions[2]).toMatchObject({ characterId: 11 })
  })

  it('has nothing to attribute when the scene has no cast', () => {
    expect(parseMemoryBullets('- A fact.', [])).toEqual([])
  })
})

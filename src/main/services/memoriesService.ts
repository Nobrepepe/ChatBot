/**
 * Pure memory-proposal helpers: parsing the model's memory actions, and the
 * bullet-list fallback for models that ignore the action contract.
 */

import {
  MEMORY_ACTION_TYPES,
  MEMORY_TYPES,
  type Character,
  type MemoryActionType,
  type MemoryType
} from '@shared/types'
import { extractActionBlocks } from '../prompt/actionBlocks'

export interface MemoryAction {
  actionType: MemoryActionType
  /** Set for replace and forget; null for a create, which allocates its own. */
  targetMemoryId: number | null
  characterId: number
  payload: Record<string, unknown>
}

export interface MemoryActionContext {
  /** Memory ids the model is allowed to name. */
  memoryIds: Set<number>
  /** character id -> that character's memory ids, for attributing a target. */
  ownerOf: Map<number, number>
  /** The scene's cast; a create must land on one of them. */
  characters: Character[]
}

function validType(value: unknown, fallback: MemoryType = 'canon'): MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(String(value))
    ? (String(value) as MemoryType)
    : fallback
}

/** Extract valid memory_action blocks; an invalid block stays in the text. */
export function parseMemoryActions(
  text: string,
  context: MemoryActionContext
): { visibleText: string; actions: MemoryAction[] } {
  return extractActionBlocks<MemoryAction>(
    text,
    { fenceTag: 'memory_action', types: MEMORY_ACTION_TYPES },
    (payloads) =>
      payloads.map((item) => {
        const payload: Record<string, unknown> = { ...item }
        const actionType = String(payload['type'] ?? '').toLowerCase()
        if (!(MEMORY_ACTION_TYPES as readonly string[]).includes(actionType)) {
          throw new Error('unsupported action')
        }

        if (actionType === 'create') {
          const rawCharacter = payload['character_id']
          const character =
            context.characters.find((c) => c.id === rawCharacter) ??
            (context.characters.length === 1 ? context.characters[0] : undefined)
          if (!character) throw new Error('invalid character')
          if (typeof payload['content'] !== 'string' || !payload['content'].trim()) {
            throw new Error('missing content')
          }
          payload['memory_type'] = validType(payload['memory_type'])
          return {
            actionType: 'create' as const,
            targetMemoryId: null,
            characterId: character.id,
            payload
          }
        }

        const rawTarget = payload['memory_id']
        if (
          typeof rawTarget !== 'number' ||
          !Number.isInteger(rawTarget) ||
          !context.memoryIds.has(rawTarget)
        ) {
          throw new Error('invalid target')
        }
        const owner = context.ownerOf.get(rawTarget)
        if (owner === undefined) throw new Error('unowned target')
        if (actionType === 'replace') {
          if (typeof payload['content'] !== 'string' || !payload['content'].trim()) {
            throw new Error('missing content')
          }
          payload['memory_type'] = validType(payload['memory_type'])
        }
        return {
          actionType: actionType as MemoryActionType,
          targetMemoryId: rawTarget,
          characterId: owner,
          payload
        }
      })
  )
}

const BULLET_LINE = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/

function guessCharacter(line: string, characters: Character[]): Character {
  const lowered = line.toLowerCase()
  return characters.find((c) => lowered.includes(c.name.toLowerCase())) ?? characters[0]!
}

/**
 * Older prompts asked for a plain '- fact' list and some local models still
 * answer that way. Rather than return nothing, read each bullet as a create so
 * a weaker model still produces something reviewable.
 */
export function parseMemoryBullets(text: string, characters: Character[]): MemoryAction[] {
  if (!characters.length) return []
  const actions: MemoryAction[] = []
  for (const line of text.split('\n')) {
    const match = BULLET_LINE.exec(line)
    if (!match?.[1]) continue
    const content = match[1]
    const character = guessCharacter(content, characters)
    actions.push({
      actionType: 'create',
      targetMemoryId: null,
      characterId: character.id,
      payload: { content, memory_type: 'canon' }
    })
  }
  return actions
}

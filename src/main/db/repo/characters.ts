import { getDb } from '../connection'
import type { Character, CharacterSprite, CharacterDraft, SpriteDraft } from '@shared/types'
import { assertNotHubManaged, now } from './util'

interface CharacterRow {
  id: number
  world_id: number
  name: string
  nicknames: string
  age: string
  role: string
  summary: string
  appearance: string
  personality: string
  backstory: string
  behavior_rules: string
  voice_style: string
  relationship_to_user: string
  ai_instructions: string
  portrait_path: string
  tile_image_path: string
  hub_id: string | null
  publication_id: string | null
  retired_at: string | null
  created_at: string
  updated_at: string
}

function mapCharacter(r: CharacterRow): Character {
  return {
    id: r.id,
    worldId: r.world_id,
    name: r.name,
    nicknames: r.nicknames,
    age: r.age,
    role: r.role,
    summary: r.summary,
    appearance: r.appearance,
    personality: r.personality,
    backstory: r.backstory,
    behaviorRules: r.behavior_rules,
    voiceStyle: r.voice_style,
    relationshipToUser: r.relationship_to_user,
    aiInstructions: r.ai_instructions,
    portraitPath: r.portrait_path,
    tileImagePath: r.tile_image_path,
    hubId: r.hub_id,
    publicationId: r.publication_id,
    retiredAt: r.retired_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

/**
 * The whole cast of a world, retired members included and marked — a scene that
 * already has one still needs to name them. Pickers are what filter them out.
 */
export function listCharacters(worldId: number): Character[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM characters WHERE world_id = ? ORDER BY (retired_at IS NOT NULL), name'
    )
    .all(worldId) as CharacterRow[]
  return rows.map(mapCharacter)
}

export function getCharacter(id: number): Character | null {
  const row = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id) as
    | CharacterRow
    | undefined
  return row ? mapCharacter(row) : null
}

function hubRow(id: number): { hub_id: string | null } | undefined {
  return getDb().prepare('SELECT hub_id FROM characters WHERE id = ?').get(id) as
    | { hub_id: string | null }
    | undefined
}

export function saveCharacter(draft: CharacterDraft): number {
  const db = getDb()
  const ts = now()
  const fields = {
    name: draft.name,
    nicknames: draft.nicknames ?? '',
    age: draft.age ?? '',
    role: draft.role ?? '',
    summary: draft.summary ?? '',
    appearance: draft.appearance ?? '',
    personality: draft.personality ?? '',
    backstory: draft.backstory ?? '',
    behavior_rules: draft.behaviorRules ?? '',
    voice_style: draft.voiceStyle ?? '',
    relationship_to_user: draft.relationshipToUser ?? '',
    ai_instructions: draft.aiInstructions ?? '',
    portrait_path: draft.portraitPath ?? '',
    tile_image_path: draft.tileImagePath ?? ''
  }
  if (draft.id) {
    assertNotHubManaged(hubRow(draft.id), 'character')
    db.prepare(
      `UPDATE characters SET name = @name, nicknames = @nicknames, age = @age, role = @role,
       summary = @summary, appearance = @appearance, personality = @personality,
       backstory = @backstory, behavior_rules = @behavior_rules, voice_style = @voice_style,
       relationship_to_user = @relationship_to_user, ai_instructions = @ai_instructions,
       portrait_path = @portrait_path, tile_image_path = @tile_image_path, updated_at = @ts
       WHERE id = @id`
    ).run({ ...fields, ts, id: draft.id })
    return draft.id
  }
  const info = db
    .prepare(
      `INSERT INTO characters (world_id, name, nicknames, age, role, summary, appearance,
       personality, backstory, behavior_rules, voice_style, relationship_to_user,
       ai_instructions, portrait_path, tile_image_path, created_at, updated_at)
       VALUES (@world_id, @name, @nicknames, @age, @role, @summary, @appearance, @personality,
       @backstory, @behavior_rules, @voice_style, @relationship_to_user, @ai_instructions,
       @portrait_path, @tile_image_path, @ts, @ts)`
    )
    .run({ ...fields, world_id: draft.worldId, ts })
  return Number(info.lastInsertRowid)
}

export function deleteCharacter(id: number): void {
  assertNotHubManaged(hubRow(id), 'character')
  getDb().prepare('DELETE FROM characters WHERE id = ?').run(id)
}

// ---- Sprites ----

interface SpriteRow {
  id: number
  character_id: number
  name: string
  call_sign: string
  image_path: string
  sort_order: number
}

function mapSprite(r: SpriteRow): CharacterSprite {
  return {
    id: r.id,
    characterId: r.character_id,
    name: r.name,
    callSign: r.call_sign,
    imagePath: r.image_path,
    sortOrder: r.sort_order
  }
}

export function listCharacterSprites(characterId: number): CharacterSprite[] {
  const rows = getDb()
    .prepare('SELECT * FROM character_sprites WHERE character_id = ? ORDER BY sort_order, id')
    .all(characterId) as SpriteRow[]
  return rows.map(mapSprite)
}

/** Bare, lowercase call sign — brackets belong to the wire format only. */
export const CALL_SIGN_RE = /^[a-z0-9][a-z0-9_-]*$/

export function saveCharacterSprite(draft: SpriteDraft): number {
  const callSign = draft.callSign.trim().toLowerCase()
  if (!CALL_SIGN_RE.test(callSign)) {
    throw new Error('Use a call sign such as sad or sword-attack — lowercase letters, digits, - and _.')
  }
  assertNotHubManaged(hubRow(draft.characterId), 'character')
  const db = getDb()
  if (draft.id) {
    db.prepare(
      'UPDATE character_sprites SET name = ?, call_sign = ?, image_path = ?, sort_order = ? WHERE id = ?'
    ).run(draft.name, callSign, draft.imagePath, draft.sortOrder ?? 0, draft.id)
    return draft.id
  }
  const info = db
    .prepare(
      `INSERT INTO character_sprites (character_id, name, call_sign, image_path, sort_order)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(character_id, call_sign)
       DO UPDATE SET name = excluded.name, image_path = excluded.image_path`
    )
    .run(draft.characterId, draft.name, callSign, draft.imagePath, draft.sortOrder ?? 0)
  return Number(info.lastInsertRowid)
}

export function deleteCharacterSprite(id: number): void {
  getDb().prepare('DELETE FROM character_sprites WHERE id = ?').run(id)
}

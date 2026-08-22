/**
 * World Hub consumer.
 *
 * Each activated publication is imported as its own immutable set of canonical
 * rows (worlds, locations, characters, sprites, lore). Scenes pin the
 * publication that was active when they began, so existing conversations keep
 * their exact canon and retired characters stay visible in old conversations.
 * All conversational and private data — scenes, messages, memories, personas,
 * notes, settings — remains app-owned and untouched by imports.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join, extname } from 'node:path'
import type { Database } from 'better-sqlite3'
import { getDb } from '../db/connection'
import { worldhubContentDir, mediaRoot } from '../paths'
import { ACTIVE_PUBLICATION_KEY, LINKED_FOLDER_KEY, activePublicationId, getSetting, saveSetting } from '../db/repo/settings'
import {
  PackageError,
  assetFile,
  entitiesById,
  extractZipSafely,
  loadPackage,
  packageAbsolute,
  readCurrentPointer,
  publicationId as pubIdOf,
  type PackageInfo
} from './packageReader'

export const APP_TYPE = 'chat-bot.cast'

const contentDir = (): string => worldhubContentDir()
const publicationsDir = (): string => join(contentDir(), 'publications')
const receiptsDir = (): string => join(contentDir(), 'receipts')
const pointerPath = (): string => join(contentDir(), 'current.json')
const hubMediaRoot = (): string => join(mediaRoot(), 'worldhub')

export interface UpdatePreview {
  publicationId: string
  productionName: string
  productionRevision: number
  publishedAt: string
  addedWorlds: string[]
  addedCharacters: string[]
  updatedCharacters: string[]
  retiredCharacters: string[]
  loreDocuments: number
  pinnedScenes: number
  alreadyActive: boolean
}

export interface StagedPackage {
  package: PackageInfo
  stagingDir: string
  sourceType: 'zip' | 'folder' | 'rollback'
  sourcePath: string
}

export interface HubStatus {
  hubMode: boolean
  publicationId: string | null
  receipt: Record<string, any> | null
  previousPublicationId: string | null
  linkedFolder: string
}

/** Staged packages held in main-process memory, keyed for the renderer. */
const stagedById = new Map<number, StagedPackage>()
let nextStagedId = 1

export function holdStaged(staged: StagedPackage): number {
  const id = nextStagedId++
  stagedById.set(id, staged)
  return id
}

export function takeStaged(id: number): StagedPackage {
  const staged = stagedById.get(id)
  if (!staged) throw new PackageError('The staged package has expired — stage it again.')
  stagedById.delete(id)
  return staged
}

export function cleanupStaged(staged: StagedPackage): void {
  rmSync(staged.stagingDir, { recursive: true, force: true })
}

function tmpRoot(): string {
  const tmp = join(contentDir(), 'tmp')
  mkdirSync(tmp, { recursive: true })
  return tmp
}

export function semanticValidation(pkg: PackageInfo): void {
  const selections = pkg.content['selections'] ?? {}
  if (!selections['cb_worlds']?.length) throw new PackageError('The package selects no worlds.')
  if (!selections['cast']?.length) throw new PackageError('The package selects no characters.')
  const assetSets = pkg.content['assetSets'] ?? {}
  for (const characterId of selections['cast'] ?? []) {
    for (const sprite of assetSets[`sprites:${characterId}`] ?? []) {
      const expression = sprite?.['values']?.['expression']
      if (!expression || !String(expression).trim()) {
        throw new PackageError('A sprite is missing its expression name.')
      }
    }
  }
}

export async function stageZip(zipPath: string): Promise<StagedPackage> {
  const staging = mkdtempSync(join(tmpRoot(), 'worldhub-stage-'))
  try {
    await extractZipSafely(zipPath, staging)
    const pkg = loadPackage(staging, APP_TYPE)
    semanticValidation(pkg)
    return { package: pkg, stagingDir: staging, sourceType: 'zip', sourcePath: zipPath }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    throw err
  }
}

export function stageLinkedFolder(productionDir?: string): StagedPackage {
  const dir = productionDir ?? linkedFolder()
  if (!dir) throw new PackageError('No World Hub production folder is linked.')
  const pointer = readCurrentPointer(dir)
  if (!pointer) throw new PackageError('The linked folder has no readable current.json pointer.')
  const source = join(dir, 'publications', pointer['publicationId'])
  try {
    if (!statSync(source).isDirectory()) throw new Error('not a dir')
  } catch {
    throw new PackageError("The linked folder's active publication is missing.")
  }
  const staging = mkdtempSync(join(tmpRoot(), 'worldhub-stage-'))
  try {
    cpSync(source, staging, { recursive: true })
    const pkg = loadPackage(staging, APP_TYPE)
    semanticValidation(pkg)
    return { package: pkg, stagingDir: staging, sourceType: 'folder', sourcePath: dir }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    throw err
  }
}

export function linkFolder(productionDir: string): void {
  if (!readCurrentPointer(productionDir)) {
    throw new PackageError('That folder is not a World Hub production folder (no current.json).')
  }
  saveSetting(LINKED_FOLDER_KEY, productionDir)
}

export function linkedFolder(): string | null {
  const raw = getSetting(LINKED_FOLDER_KEY)
  return raw || null
}

export function status(): HubStatus {
  const active = activePublicationId()
  let receipt: Record<string, any> | null = null
  if (active) {
    try {
      receipt = JSON.parse(readFileSync(join(receiptsDir(), `${active}.json`), 'utf8'))
    } catch {
      receipt = null
    }
  }
  const pointer = readCurrentPointer(contentDir())
  return {
    hubMode: active !== null,
    publicationId: active,
    receipt,
    previousPublicationId: pointer?.['previousPublicationId'] ?? null,
    linkedFolder: linkedFolder() ?? ''
  }
}

export function preview(staged: StagedPackage): UpdatePreview {
  const pkg = staged.package
  const entities = entitiesById(pkg)
  const selections = pkg.content['selections'] ?? {}
  const db = getDb()

  const knownWorlds = new Set(
    (db.prepare('SELECT DISTINCT hub_id FROM worlds WHERE hub_id IS NOT NULL').all() as { hub_id: string }[]).map((r) => r.hub_id)
  )
  const knownCharacters = new Set(
    (db.prepare('SELECT DISTINCT hub_id FROM characters WHERE hub_id IS NOT NULL').all() as { hub_id: string }[]).map((r) => r.hub_id)
  )
  const pinnedScenes = (
    db.prepare('SELECT COUNT(*) AS n FROM scenes WHERE publication_id IS NOT NULL').get() as { n: number }
  ).n

  const result: UpdatePreview = {
    publicationId: pubIdOf(pkg),
    productionName: pkg.manifest['production']['name'],
    productionRevision: pkg.manifest['production']['revision'],
    publishedAt: pkg.manifest['publishedAt'],
    addedWorlds: [],
    addedCharacters: [],
    updatedCharacters: [],
    retiredCharacters: [],
    loreDocuments: pkg.documents.length,
    pinnedScenes,
    alreadyActive: pubIdOf(pkg) === activePublicationId()
  }

  for (const worldId of selections['cb_worlds'] ?? []) {
    if (!knownWorlds.has(worldId)) {
      result.addedWorlds.push(entities.get(worldId)?.['name'] ?? worldId)
    }
  }
  const castIds = new Set<string>(selections['cast'] ?? [])
  for (const characterId of castIds) {
    const name = entities.get(characterId)?.['name'] ?? characterId
    if (knownCharacters.has(characterId)) result.updatedCharacters.push(name)
    else result.addedCharacters.push(name)
  }
  const active = activePublicationId()
  if (active) {
    const rows = db
      .prepare('SELECT name, hub_id FROM characters WHERE publication_id = ?')
      .all(active) as { name: string; hub_id: string }[]
    for (const row of rows) {
      if (!castIds.has(row.hub_id)) result.retiredCharacters.push(row.name)
    }
  }
  return result
}

/** Import the staged package as a new canonical snapshot and switch to it. */
export function activate(staged: StagedPackage): HubStatus {
  const pkg = staged.package
  const publicationId = pubIdOf(pkg)
  const previousActive = activePublicationId()
  const mediaDir = join(hubMediaRoot(), publicationId)
  const db = getDb()

  try {
    const importTx = db.transaction(() => {
      importContent(db, pkg, publicationId, mediaDir)
      db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(ACTIVE_PUBLICATION_KEY, publicationId)
    })
    importTx()

    mkdirSync(publicationsDir(), { recursive: true })
    const destination = join(publicationsDir(), publicationId)
    let destinationExists = false
    try {
      destinationExists = statSync(destination).isDirectory()
    } catch {
      destinationExists = false
    }
    if (!destinationExists) {
      try {
        renameSync(staged.stagingDir, destination)
      } catch {
        cpSync(staged.stagingDir, destination, { recursive: true })
        cleanupStaged(staged)
      }
    } else {
      cleanupStaged(staged)
    }
    writeReceipt(pkg, staged, destination)
    writePointer(publicationId, previousActive)
  } catch (err) {
    cleanupStaged(staged)
    rmSync(mediaDir, { recursive: true, force: true })
    throw err
  }
  return status()
}

export function rollback(): HubStatus {
  const pointer = readCurrentPointer(contentDir())
  const previous = pointer?.['previousPublicationId']
  if (!previous) throw new PackageError('There is no previous publication to roll back to.')
  const source = join(publicationsDir(), previous)
  try {
    if (!statSync(source).isDirectory()) throw new Error('missing')
  } catch {
    throw new PackageError("The previous publication's files are no longer available.")
  }
  const staging = mkdtempSync(join(tmpRoot(), 'worldhub-stage-'))
  try {
    cpSync(source, staging, { recursive: true })
    const pkg = loadPackage(staging, APP_TYPE)
    semanticValidation(pkg)
    return activate({ package: pkg, stagingDir: staging, sourceType: 'rollback', sourcePath: source })
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    throw err
  }
}

export function checkForUpdate(): UpdatePreview {
  const staged = stageLinkedFolder()
  try {
    return preview(staged)
  } finally {
    cleanupStaged(staged)
  }
}

/** Explicitly move one conversation to the active publication's canon. */
export function migrateScene(sceneId: number): void {
  const active = activePublicationId()
  if (!active) throw new PackageError('No World Hub publication is active.')
  const db = getDb()
  const run = db.transaction(() => {
    const scene = db.prepare('SELECT * FROM scenes WHERE id = ?').get(sceneId) as
      | { id: number; world_id: number }
      | undefined
    if (!scene) throw new PackageError('That conversation no longer exists.')
    const oldWorld = db.prepare('SELECT hub_id FROM worlds WHERE id = ?').get(scene.world_id) as
      | { hub_id: string | null }
      | undefined
    const newWorld = db
      .prepare('SELECT id FROM worlds WHERE publication_id = ? AND hub_id = ?')
      .get(active, oldWorld?.hub_id ?? null) as { id: number } | undefined
    if (!newWorld) {
      throw new PackageError("The conversation's world is not part of the active publication.")
    }
    const characterRows = db
      .prepare(
        `SELECT c.id, c.hub_id, c.name FROM scene_characters sc
         JOIN characters c ON c.id = sc.character_id WHERE sc.scene_id = ?`
      )
      .all(sceneId) as { id: number; hub_id: string | null; name: string }[]
    const replacements: [number, number][] = []
    for (const row of characterRows) {
      const match = db
        .prepare('SELECT id FROM characters WHERE publication_id = ? AND hub_id = ?')
        .get(active, row.hub_id) as { id: number } | undefined
      if (!match) {
        throw new PackageError(
          `“${row.name}” is not in the active publication; the conversation stays pinned.`
        )
      }
      replacements.push([row.id, match.id])
    }
    db.prepare('UPDATE scenes SET world_id = ?, publication_id = ?, location_id = NULL WHERE id = ?').run(
      newWorld.id,
      active,
      sceneId
    )
    for (const [oldId, newId] of replacements) {
      db.prepare(
        'UPDATE scene_characters SET character_id = ? WHERE scene_id = ? AND character_id = ?'
      ).run(newId, sceneId, oldId)
    }
  })
  run()
}

// -- import -------------------------------------------------------------------

/** Copy one packaged file under the served media dir; returns the media-relative path. */
function copyMedia(
  pkg: PackageInfo,
  mediaDir: string,
  assetId: string | null | undefined,
  preferred: string[]
): string {
  if (!assetId) return ''
  const entry = assetFile(pkg, assetId, preferred)
  if (!entry) return ''
  const suffix = extname(entry.path)
  const target = join(mediaDir, `${assetId}-${entry.recipeId}${suffix}`)
  mkdirSync(mediaDir, { recursive: true })
  cpSync(packageAbsolute(pkg, entry.path), target)
  // Stored relative to the media root so media:// can serve it.
  return target.slice(mediaRoot().length + 1).replace(/\\/g, '/')
}

const KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
  'has', 'have', 'had', 'its', 'their', 'they', 'them', 'you', 'your', 'our'
])

/**
 * Hub lore keyword derivation (deliberate improvement over the Flet app, which
 * imported lore with no keywords so it never matched): the document title plus
 * the names of the entities it references become the trigger keywords. Local
 * overrides in lore_keyword_overrides take precedence and survive re-import.
 */
function deriveLoreKeywords(title: string, entityNames: string[]): string[] {
  const keywords = new Set<string>()
  for (const name of entityNames) {
    const trimmed = name.trim().toLowerCase()
    if (trimmed.length >= 3) keywords.add(trimmed)
  }
  for (const token of title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (token.length >= 3 && !KEYWORD_STOPWORDS.has(token)) keywords.add(token)
  }
  return [...keywords]
}

function importContent(db: Database, pkg: PackageInfo, publicationId: string, mediaDir: string): void {
  const entities = entitiesById(pkg)
  const content = pkg.content
  const selections = content['selections'] ?? {}
  const assetSets = content['assetSets'] ?? {}
  const entityValues = content['entityValues'] ?? {}
  const worldProfiles = new Map(pkg.worlds.map((w) => [w['id'], w]))
  const characterProfiles = new Map(pkg.characters.map((c) => [c['id'], c]))
  const ts = new Date().toISOString()

  const setAsset = (slot: string, entityId: string): string | null => {
    const items = assetSets[`${slot}:${entityId}`] ?? []
    return items[0]?.['assetId'] ?? null
  }

  // Idempotent re-activation: this publication's rows are rebuilt, but rows
  // still referenced by pinned scenes survive.
  db.prepare('DELETE FROM lore_entries WHERE publication_id = ?').run(publicationId)
  db.prepare('DELETE FROM locations WHERE publication_id = ?').run(publicationId)
  db.prepare(
    'DELETE FROM character_sprites WHERE character_id IN (SELECT id FROM characters WHERE publication_id = ?)'
  ).run(publicationId)
  db.prepare(
    'DELETE FROM characters WHERE publication_id = ? AND id NOT IN (SELECT character_id FROM scene_characters)'
  ).run(publicationId)
  db.prepare(
    'DELETE FROM worlds WHERE publication_id = ? AND id NOT IN (SELECT world_id FROM scenes)'
  ).run(publicationId)

  const worldLocalIds = new Map<string, number>()
  for (const hubWorldId of selections['cb_worlds'] ?? []) {
    const entity = entities.get(hubWorldId)!
    const profile = worldProfiles.get(hubWorldId) ?? {}
    const values = entityValues[hubWorldId] ?? {}
    const cover = copyMedia(pkg, mediaDir, setAsset('cb_world_cover', hubWorldId), ['landscape_16x9'])
    const background = copyMedia(pkg, mediaDir, setAsset('session_background', hubWorldId), ['landscape_16x9'])
    const info = db
      .prepare(
        `INSERT INTO worlds (name, genre, tone, summary, setting_description, style_guide,
         cover_image_path, session_background_path, hub_id, publication_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entity['name'],
        profile['genre'] ?? '',
        profile['tone'] ?? '',
        entity['summary'] ?? '',
        profile['settingDescription'] ?? '',
        values['world_style_guide'] ?? '',
        cover,
        background,
        hubWorldId,
        publicationId,
        ts,
        ts
      )
    worldLocalIds.set(hubWorldId, Number(info.lastInsertRowid))
  }

  for (const hubPlaceId of selections['places'] ?? []) {
    const entity = entities.get(hubPlaceId)!
    const values = entityValues[hubPlaceId] ?? {}
    const worldLocal = worldLocalIds.get(entity['worldId'])
    if (worldLocal === undefined) continue
    const background = copyMedia(pkg, mediaDir, setAsset('location_background', hubPlaceId), ['landscape_16x9'])
    db.prepare(
      `INSERT INTO locations (world_id, name, description, background_path, mood_tags, hub_id, publication_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      worldLocal,
      entity['name'],
      entity['summary'] ?? '',
      background,
      values['loc_mood_tags'] ?? '',
      hubPlaceId,
      publicationId
    )
  }

  for (const hubCharacterId of selections['cast'] ?? []) {
    const entity = entities.get(hubCharacterId)!
    const profile = characterProfiles.get(hubCharacterId) ?? {}
    const values = entityValues[hubCharacterId] ?? {}
    const worldLocal = worldLocalIds.get(entity['worldId'])
    if (worldLocal === undefined) {
      throw new PackageError("A character's world is not part of the package.")
    }
    const tile = copyMedia(pkg, mediaDir, setAsset('tile', hubCharacterId), ['square', 'thumbnail_square'])

    // The neutral sprite (or the profile portrait) becomes the portrait column;
    // every other expression becomes a character_sprites row with a bare call sign.
    const sprites: { expression: string; assetId: string }[] = (
      assetSets[`sprites:${hubCharacterId}`] ?? []
    ).map((s: Record<string, any>) => ({
      expression: String(s['values']?.['expression'] ?? '').trim().toLowerCase(),
      assetId: s['assetId']
    }))
    let portraitPath = ''
    const neutral = sprites.find((s) => s.expression === 'neutral')
    if (neutral) {
      portraitPath = copyMedia(pkg, mediaDir, neutral.assetId, ['portrait_9x16'])
    } else if (profile['portraitAssetId']) {
      portraitPath = copyMedia(pkg, mediaDir, profile['portraitAssetId'], ['portrait_9x16', 'square'])
    }

    const info = db
      .prepare(
        `INSERT INTO characters (world_id, name, nicknames, age, role, summary, appearance,
         personality, backstory, behavior_rules, voice_style, relationship_to_user,
         ai_instructions, portrait_path, tile_image_path, hub_id, publication_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        worldLocal,
        entity['name'],
        (entity['aliases'] ?? []).join(', '),
        profile['age'] ?? '',
        profile['role'] ?? '',
        entity['summary'] ?? '',
        profile['appearance'] ?? '',
        profile['personality'] ?? '',
        profile['biography'] ?? '',
        values['char_behavior_rules'] ?? '',
        profile['voice'] ?? '',
        values['char_relationship_to_user'] ?? '',
        values['char_ai_instructions'] ?? '',
        portraitPath,
        tile,
        hubCharacterId,
        publicationId,
        ts,
        ts
      )
    const localCharacter = Number(info.lastInsertRowid)
    let order = 0
    for (const sprite of sprites) {
      if (sprite.expression === 'neutral' || !sprite.expression) continue
      const path = copyMedia(pkg, mediaDir, sprite.assetId, ['portrait_9x16'])
      if (!path) continue
      const callSign = sprite.expression.replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+/, '')
      if (!callSign) continue
      db.prepare(
        `INSERT INTO character_sprites (character_id, name, call_sign, image_path, sort_order)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(character_id, call_sign) DO UPDATE SET image_path = excluded.image_path`
      ).run(
        localCharacter,
        sprite.expression.charAt(0).toUpperCase() + sprite.expression.slice(1),
        callSign,
        path,
        order++
      )
    }
  }

  // Linked Hub Markdown replaces published lore entries for these worlds.
  for (const document of pkg.documents) {
    const body = readFileSync(packageAbsolute(pkg, document['path']), 'utf8')
    let targetWorld: number | undefined
    const referencedNames: string[] = []
    for (const entityId of document['entityIds'] ?? []) {
      const entity = entities.get(entityId) ?? {}
      if (entity['name']) referencedNames.push(entity['name'])
      const candidate = entity['type'] === 'world' ? entityId : entity['worldId']
      if (targetWorld === undefined && worldLocalIds.has(candidate)) {
        targetWorld = worldLocalIds.get(candidate)
      }
    }
    if (targetWorld === undefined) continue
    const keywords = deriveLoreKeywords(String(document['title'] ?? ''), referencedNames)
    db.prepare(
      `INSERT INTO lore_entries (world_id, title, content, keywords_json, always_include,
       hub_id, publication_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
    ).run(targetWorld, document['title'], body, JSON.stringify(keywords), document['id'], publicationId, ts, ts)
  }
}

// -- receipts and pointer -----------------------------------------------------

function writeReceipt(pkg: PackageInfo, staged: StagedPackage, storedAt: string): void {
  mkdirSync(receiptsDir(), { recursive: true })
  const manifest = pkg.manifest
  const receipt = {
    sourceLibraryId: manifest['sourceLibraryId'],
    productionId: manifest['production']['id'],
    productionName: manifest['production']['name'],
    productionRevision: manifest['production']['revision'],
    publicationId: manifest['publicationId'],
    applicationType: manifest['applicationType'],
    contractId: manifest['contract']['id'],
    contractVersion: manifest['contract']['version'],
    publishedAt: manifest['publishedAt'],
    importedAt: new Date().toISOString(),
    sourceType: staged.sourceType,
    sourcePath: staged.sourcePath,
    storedAt,
    packageFingerprint: pkg.checksums['manifest.json'] ?? ''
  }
  atomicWrite(join(receiptsDir(), `${pubIdOf(pkg)}.json`), JSON.stringify(receipt, null, 2))
}

function writePointer(publicationId: string, previous: string | null): void {
  const pointer = {
    publicationId,
    previousPublicationId: previous !== publicationId ? previous : null,
    activatedAt: new Date().toISOString()
  }
  atomicWrite(pointerPath(), JSON.stringify(pointer, null, 2))
}

function atomicWrite(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.worldhub-tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  const fd = openSync(tmp, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

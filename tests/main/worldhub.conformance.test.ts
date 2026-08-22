import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { useTempDataDir } from './helpers'
import { getDb } from '@main/db/connection'
import * as hub from '@main/worldhub/consumerService'
import { PackageError } from '@main/worldhub/packageReader'
import * as worldsRepo from '@main/db/repo/worlds'
import * as charactersRepo from '@main/db/repo/characters'
import * as loreRepo from '@main/db/repo/lore'
import * as scenesRepo from '@main/db/repo/scenes'
import * as messagesRepo from '@main/db/repo/messages'
import * as memoriesRepo from '@main/db/repo/memories'
import * as personasRepo from '@main/db/repo/personas'
import * as notesRepo from '@main/db/repo/notes'
import * as settingsRepo from '@main/db/repo/settings'
import * as chat from '@main/services/chatService'

const FIXTURES = join(__dirname, '..', 'fixtures', 'worldhub')
const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as {
  publicationV1: string
  publicationV2: string
  worldId: string
  characterIds: string[]
  renamedCharacterId: string
  retiredCharacterIds: string[]
}

let cleanup: () => void

beforeEach(() => {
  cleanup = useTempDataDir()
})

afterEach(() => cleanup())

async function activateZip(name: string): Promise<void> {
  const staged = await hub.stageZip(join(FIXTURES, name))
  hub.activate(staged)
}

describe('installing a publication', () => {
  it('imports worlds, characters, sprites and lore from valid-v1', async () => {
    await activateZip('valid-v1.zip')

    expect(settingsRepo.activePublicationId()).toBe(expected.publicationV1)
    const worlds = worldsRepo.listWorlds()
    expect(worlds).toHaveLength(1)
    const world = worlds[0]!
    expect(world.hubId).toBe(expected.worldId)
    expect(world.publicationId).toBe(expected.publicationV1)

    const characters = charactersRepo.listCharacters(world.id)
    expect(characters.map((c) => c.hubId).sort()).toEqual([...expected.characterIds].sort())
    // Behavior rules come from the production's contract fields.
    expect(characters.some((c) => c.behaviorRules.includes('Never breaks character'))).toBe(true)
    // Every character has a portrait (neutral sprite or profile portrait).
    for (const c of characters) {
      expect(c.portraitPath).not.toBe('')
      expect(existsSync(join(process.env['CHATBOT_DATA_DIR']!, 'media', c.portraitPath))).toBe(true)
    }

    // Linked Markdown became exactly one lore entry, with derived keywords.
    const lore = loreRepo.listLoreEntries(world.id)
    expect(lore).toHaveLength(1)
    expect(lore[0]!.title).toContain('Accord')
    expect(lore[0]!.hubId).not.toBeNull()
    expect(lore[0]!.keywords.length).toBeGreaterThan(0)
  })

  it('feeds imported content into scene prompts', async () => {
    await activateZip('valid-v1.zip')
    const world = worldsRepo.listWorlds()[0]!
    const character = charactersRepo
      .listCharacters(world.id)
      .find((c) => c.behaviorRules.includes('Never breaks character'))!
    const sceneId = scenesRepo.saveScene({ worldId: world.id, characterIds: [character.id] })
    const built = chat.build(sceneId).built
    const system = built.messages[0]!.content
    expect(system).toContain('Never breaks character')
    expect(system).toContain(world.name)
  })
})

describe('updates and pinning', () => {
  async function installV1WithPrivateData(): Promise<{
    sceneId: number
    worldId: number
    characterId: number
    personaId: number
    noteId: number
  }> {
    await activateZip('valid-v1.zip')
    const world = worldsRepo.listWorlds()[0]!
    const characters = charactersRepo.listCharacters(world.id)
    const character = characters[0]!
    const personaId = personasRepo.savePersona({ name: 'Rui', description: 'A scribe.' })
    const sceneId = scenesRepo.saveScene({
      worldId: world.id,
      title: 'Pinned scene',
      characterIds: characters.map((c) => c.id),
      personaId
    })
    messagesRepo.addMessage({ sceneId, role: 'user', content: 'hello' })
    memoriesRepo.saveMemory({ characterId: character.id, type: 'canon', content: 'A fact.' })
    const noteId = notesRepo.saveWorldNote({ worldId: world.id, title: 'Private', content: 'note' })
    return { sceneId, worldId: world.id, characterId: character.id, personaId, noteId }
  }

  it('preserves private data across an update and keeps the scene pinned to v1', async () => {
    const ids = await installV1WithPrivateData()
    await activateZip('valid-v2.zip')

    expect(settingsRepo.activePublicationId()).toBe(expected.publicationV2)
    // Private data survived untouched.
    expect(messagesRepo.listMessages(ids.sceneId)).toHaveLength(1)
    expect(memoriesRepo.listMemories(ids.characterId, { status: 'any' })).toHaveLength(1)
    expect(personasRepo.getPersona(ids.personaId)).not.toBeNull()
    expect(notesRepo.getWorldNote(ids.noteId)).not.toBeNull()

    // The scene still resolves its original v1 rows.
    const scene = scenesRepo.getScene(ids.sceneId)!
    expect(scene.publicationId).toBe(expected.publicationV1)
    const pinnedWorld = worldsRepo.getWorld(scene.worldId)!
    expect(pinnedWorld.publicationId).toBe(expected.publicationV1)

    // Canonical listings show v2; retired characters disappear from them but
    // remain fetchable by id for old conversations.
    const canonWorlds = worldsRepo.listWorlds()
    const v2World = canonWorlds.find((w) => w.publicationId === expected.publicationV2)!
    const v2Characters = charactersRepo.listCharacters(v2World.id)
    for (const retired of expected.retiredCharacterIds) {
      expect(v2Characters.some((c) => c.hubId === retired)).toBe(false)
    }
    const oldCharacter = charactersRepo.getCharacter(ids.characterId)!
    expect(oldCharacter.publicationId).toBe(expected.publicationV1)
  })

  it('reports added, updated and retired characters in the preview', async () => {
    await activateZip('valid-v1.zip')
    const staged = await hub.stageZip(join(FIXTURES, 'valid-v2.zip'))
    const preview = hub.preview(staged)
    hub.cleanupStaged(staged)
    expect(preview.alreadyActive).toBe(false)
    expect(preview.updatedCharacters.length).toBeGreaterThan(0)
    expect(preview.retiredCharacters.length).toBeGreaterThan(0)
    expect(preview.publicationId).toBe(expected.publicationV2)
  })

  it('migrates a scene to the current canon only when every character exists there', async () => {
    const ids = await installV1WithPrivateData()
    await activateZip('valid-v2.zip')

    // The pinned scene includes a character retired in v2 → migration refuses.
    expect(() => hub.migrateScene(ids.sceneId)).toThrow(PackageError)
    expect(scenesRepo.getScene(ids.sceneId)!.publicationId).toBe(expected.publicationV1)

    // A scene with only surviving characters migrates cleanly.
    const survivingOld = charactersRepo
      .listCharacters(ids.worldId)
      .filter((c) => c.hubId && !expected.retiredCharacterIds.includes(c.hubId))
    const cleanSceneId = scenesRepo.saveScene({
      worldId: ids.worldId,
      characterIds: survivingOld.map((c) => c.id)
    })
    getDb().prepare('UPDATE scenes SET publication_id = ? WHERE id = ?').run(expected.publicationV1, cleanSceneId)
    hub.migrateScene(cleanSceneId)
    const migrated = scenesRepo.getScene(cleanSceneId)!
    expect(migrated.publicationId).toBe(expected.publicationV2)
    const migratedWorld = worldsRepo.getWorld(migrated.worldId)!
    expect(migratedWorld.publicationId).toBe(expected.publicationV2)
  })

  it('rolls back to the previous publication from the local cache', async () => {
    await activateZip('valid-v1.zip')
    await activateZip('valid-v2.zip')
    expect(settingsRepo.activePublicationId()).toBe(expected.publicationV2)
    hub.rollback()
    expect(settingsRepo.activePublicationId()).toBe(expected.publicationV1)
  })

  it('re-activating the same publication is idempotent', async () => {
    await activateZip('valid-v1.zip')
    const before = worldsRepo.listWorlds().length
    await activateZip('valid-v1.zip')
    expect(worldsRepo.listWorlds()).toHaveLength(before)
  })
})

describe('bad packages change nothing', () => {
  const badFixtures = [
    'corrupt-checksum.zip',
    'unlisted-file.zip',
    'missing-asset.zip',
    'wrong-apptype.zip',
    'unsupported-protocol.zip',
    'traversal.zip'
  ]

  for (const fixture of badFixtures) {
    it(`rejects ${fixture} and leaves state untouched`, async () => {
      await activateZip('valid-v1.zip')
      const world = worldsRepo.listWorlds()[0]!
      const character = charactersRepo.listCharacters(world.id)[0]!
      const sceneId = scenesRepo.saveScene({ worldId: world.id, characterIds: [character.id] })
      messagesRepo.addMessage({ sceneId, role: 'user', content: 'kept' })

      await expect(hub.stageZip(join(FIXTURES, fixture))).rejects.toThrow(PackageError)

      expect(settingsRepo.activePublicationId()).toBe(expected.publicationV1)
      expect(messagesRepo.listMessages(sceneId)).toHaveLength(1)
    })
  }
})

describe('linked production folder', () => {
  it('links, checks for update, activates, and works offline afterwards', async () => {
    // Build the folder by extracting v2 through the safe extractor.
    const staged = await hub.stageZip(join(FIXTURES, 'valid-v2.zip'))
    const folder = join(process.env['CHATBOT_DATA_DIR']!, 'production-folder')
    const pubDir = join(folder, 'publications', expected.publicationV2)
    mkdirSync(pubDir, { recursive: true })
    cpSync(staged.stagingDir, pubDir, { recursive: true })
    hub.cleanupStaged(staged)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      join(folder, 'current.json'),
      JSON.stringify({ publicationId: expected.publicationV2 })
    )

    await activateZip('valid-v1.zip')
    hub.linkFolder(folder)
    const preview = hub.checkForUpdate()
    expect(preview.publicationId).toBe(expected.publicationV2)
    expect(preview.alreadyActive).toBe(false)
    expect(preview.retiredCharacters.length).toBeGreaterThan(0)

    const stagedFolder = hub.stageLinkedFolder()
    hub.activate(stagedFolder)
    expect(settingsRepo.activePublicationId()).toBe(expected.publicationV2)

    // Offline: the production folder disappears, the local cache still works.
    rmSync(folder, { recursive: true, force: true })
    hub.rollback()
    expect(settingsRepo.activePublicationId()).toBe(expected.publicationV1)
    expect(hub.status().hubMode).toBe(true)
  })

  it('refuses to link a folder without current.json', () => {
    const dir = join(process.env['CHATBOT_DATA_DIR']!, 'not-a-production')
    mkdirSync(dir, { recursive: true })
    expect(() => hub.linkFolder(dir)).toThrow(PackageError)
  })
})

describe('status and receipts', () => {
  it('reports hub mode with a receipt after activation', async () => {
    expect(hub.status().hubMode).toBe(false)
    await activateZip('valid-v1.zip')
    const status = hub.status()
    expect(status.hubMode).toBe(true)
    expect(status.publicationId).toBe(expected.publicationV1)
    expect(status.receipt?.['productionName']).toBeTruthy()
    expect(status.receipt?.['sourceType']).toBe('zip')
  })
})

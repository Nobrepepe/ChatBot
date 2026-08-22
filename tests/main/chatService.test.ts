import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTempDataDir } from './helpers'
import * as worlds from '@main/db/repo/worlds'
import * as charactersRepo from '@main/db/repo/characters'
import * as scenesRepo from '@main/db/repo/scenes'
import * as messagesRepo from '@main/db/repo/messages'
import * as memoriesRepo from '@main/db/repo/memories'
import * as chat from '@main/services/chatService'

// The provider is mocked; each test decides what the "model" answers.
vi.mock('@main/providers/openaiCompat', async (importOriginal) => {
  const original = await importOriginal<typeof import('@main/providers/openaiCompat')>()
  return { ...original, streamChat: vi.fn() }
})
import { streamChat } from '@main/providers/openaiCompat'

const mockedStream = vi.mocked(streamChat)

function answerWith(text: string): void {
  mockedStream.mockImplementation(async function* () {
    yield text
  })
}

let cleanup: () => void
let sceneId: number
let liraelId: number
let morganaId: number

beforeEach(() => {
  cleanup = useTempDataDir()
  mockedStream.mockReset()
  const worldId = worlds.saveWorld({ name: 'Eden' })
  liraelId = charactersRepo.saveCharacter({ worldId, name: 'Lirael' })
  morganaId = charactersRepo.saveCharacter({ worldId, name: 'Morgana' })
  sceneId = scenesRepo.saveScene({
    worldId,
    title: 'The rooftop',
    premise: 'A storm.',
    mode: 'roleplay',
    characterIds: [liraelId, morganaId]
  })
})

afterEach(() => cleanup())

describe('build', () => {
  it('appends a turn-control user message for respond-to-latest', () => {
    const result = chat.build(sceneId, { responderId: morganaId, respondToLatest: true })
    const last = result.built.messages.at(-1)!
    expect(last.role).toBe('user')
    expect(last.content).toContain('[Turn control: Morgana now responds directly')
  })

  it('truncates history at beforeMessageId for continuations', () => {
    chat.addUserMessage(sceneId, 'one')
    const cutoff = messagesRepo.addMessage({ sceneId, role: 'character', characterId: liraelId, content: 'two' })
    chat.addUserMessage(sceneId, 'three')
    const result = chat.build(sceneId, { beforeMessageId: cutoff })
    const contents = result.built.messages.slice(1).map((m) => m.content)
    expect(contents).toEqual(['one'])
  })
})

describe('saveReply', () => {
  it('parses {Name} and [emotion] wire tags into structured columns', () => {
    charactersRepo.saveCharacterSprite({
      characterId: morganaId,
      name: 'Sad',
      callSign: 'sad',
      imagePath: 'x.png'
    })
    const buildResult = chat.build(sceneId, { responderId: morganaId })
    const saved = chat.saveReply(sceneId, '{Morgana} [sad] "Not really."', buildResult)
    expect(saved.characterId).toBe(morganaId)
    expect(saved.emotion).toBe('sad')
    expect(saved.content).toBe('"Not really."')
    const stored = messagesRepo.getMessage(saved.messageId)!
    expect(stored.content).toBe('"Not really."')
    expect(stored.characterId).toBe(morganaId)
    expect(stored.emotion).toBe('sad')
  })

  it('attributes an unlabeled reply to the responder', () => {
    const buildResult = chat.build(sceneId, { responderId: liraelId })
    const saved = chat.saveReply(sceneId, 'Just words.', buildResult)
    expect(saved.characterId).toBe(liraelId)
    expect(saved.content).toBe('Just words.')
  })
})

describe('summarize', () => {
  it('stores the summary on the scene', async () => {
    answerWith('- They met on the rooftop.')
    const summary = await chat.summarize(sceneId)
    expect(summary).toBe('- They met on the rooftop.')
    expect(scenesRepo.getScene(sceneId)!.summary).toBe('- They met on the rooftop.')
  })
})

describe('impersonate', () => {
  it('requires a persona', async () => {
    await expect(chat.impersonate(sceneId)).rejects.toThrow('Choose a persona in scene setup first.')
  })
})

describe('exportScene', () => {
  it('writes a Markdown transcript with structured speakers, skipping deleted turns', async () => {
    const { readFileSync } = await import('node:fs')
    chat.addUserMessage(sceneId, 'I came looking for you.')
    messagesRepo.addMessage({ sceneId, role: 'character', characterId: morganaId, content: '"You found me."' })
    messagesRepo.addMessage({ sceneId, role: 'narrator', content: '*Wind rises.*' })
    const dead = messagesRepo.addMessage({ sceneId, role: 'user', content: 'deleted' })
    messagesRepo.deleteMessage(dead)

    const path = chat.exportScene(sceneId)
    const text = readFileSync(path, 'utf8')
    expect(text).toContain('# The rooftop')
    expect(text).toContain('**You:** I came looking for you.')
    expect(text).toContain('**Morgana:** "You found me."')
    expect(text).toContain('**Narrator:** *Wind rises.*')
    expect(text).not.toContain('deleted')
  })
})

describe('suggestMemories', () => {
  it('persists each bullet as a pending canon memory attributed by name', async () => {
    answerWith('- Morgana admitted she was afraid.\n- The rooftop is Lirael\'s refuge.\nnot a bullet')
    const saved = await chat.suggestMemories(sceneId)
    expect(saved).toHaveLength(2)
    expect(saved[0]!.characterId).toBe(morganaId)
    expect(saved[1]!.characterId).toBe(liraelId)
    const pending = memoriesRepo.listMemories(morganaId, { status: 'pending' })
    expect(pending).toHaveLength(1)
    expect(pending[0]!.status).toBe('pending')
    expect(memoriesRepo.listMemories(morganaId, { status: 'approved' })).toHaveLength(0)
  })
})

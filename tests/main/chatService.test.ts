import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTempDataDir } from './helpers'
import * as worlds from '@main/db/repo/worlds'
import * as charactersRepo from '@main/db/repo/characters'
import * as scenesRepo from '@main/db/repo/scenes'
import * as messagesRepo from '@main/db/repo/messages'
import * as memoriesRepo from '@main/db/repo/memories'
import * as personasRepo from '@main/db/repo/personas'
import * as loreRepo from '@main/db/repo/lore'
import * as settingsRepo from '@main/db/repo/settings'
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
  function withPersona(): void {
    const personaId = personasRepo.savePersona({ name: 'Rui', description: 'A scribe.' })
    scenesRepo.saveScene({
      id: sceneId,
      worldId: scenesRepo.getScene(sceneId)!.worldId,
      title: 'The rooftop',
      mode: 'roleplay',
      personaId,
      characterIds: [liraelId, morganaId]
    })
  }

  it('requires a persona', async () => {
    await expect(chat.impersonate(sceneId)).rejects.toThrow('Choose a persona in scene setup first.')
  })

  it('sends the reply prompt unchanged, with the OOC turn appended', async () => {
    withPersona()
    answerWith('I step closer.')
    const reply = chat.build(sceneId)
    await chat.impersonate(sceneId)

    const sent = mockedStream.mock.calls[0]![0]
    expect(sent.slice(0, reply.built.messages.length)).toEqual(reply.built.messages)
    expect(sent.at(-1)!.content).toContain('the USER persona')
  })

  it('strips wire tags the reused prompt invites, so none reach the composer', async () => {
    withPersona()
    charactersRepo.saveCharacterSprite({
      characterId: liraelId,
      name: 'Sad',
      callSign: 'sad',
      imagePath: 'x.png'
    })
    answerWith('{Rui} [sad] I step closer.')
    expect(await chat.impersonate(sceneId)).toBe('I step closer.')
  })
})

describe('the lore budget', () => {
  it('trims a long entry down to the configured budget', async () => {
    const worldId = scenesRepo.getScene(sceneId)!.worldId
    loreRepo.saveLoreEntry({
      worldId,
      title: 'Setting document',
      content: 'x'.repeat(70_000),
      alwaysInclude: true
    })

    settingsRepo.saveSettings({ loreBudget: '500' })
    const trimmed = chat.build(sceneId).built.messages[0]!.content
    expect(trimmed).toContain('…(trimmed to fit the lore budget)')
    expect(trimmed.length).toBeLessThan(3000)

    settingsRepo.saveSettings({ loreBudget: '0' })
    expect(chat.build(sceneId).built.messages[0]!.content.length).toBeGreaterThan(70_000)
  })
})

describe('stopping a one-shot', () => {
  it('hands the caller\'s signal to the provider, so Stop reaches the request', async () => {
    answerWith('A summary.')
    const controller = new AbortController()
    await chat.summarize(sceneId, controller.signal)
    expect(mockedStream.mock.calls[0]![2]).toBe(controller.signal)

    mockedStream.mockClear()
    answerWith('- Morgana is afraid.')
    await chat.suggestMemories(sceneId, controller.signal)
    expect(mockedStream.mock.calls[0]![2]).toBe(controller.signal)
  })

  it('writes no summary when the generation is aborted', async () => {
    mockedStream.mockImplementation(async function* () {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      yield ''
    })
    await expect(chat.summarize(sceneId, new AbortController().signal)).rejects.toThrow('aborted')
    expect(scenesRepo.getScene(sceneId)!.summary).toBe('')
  })

  it('saves no pending memories when the generation is aborted', async () => {
    mockedStream.mockImplementation(async function* () {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      yield ''
    })
    await expect(chat.suggestMemories(sceneId, new AbortController().signal)).rejects.toThrow('aborted')
    expect(memoriesRepo.listMemories(morganaId, { status: 'pending' })).toHaveLength(0)
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

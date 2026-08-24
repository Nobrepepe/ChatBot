import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTempDataDir } from './helpers'
import * as worlds from '@main/db/repo/worlds'
import * as charactersRepo from '@main/db/repo/characters'
import * as scenesRepo from '@main/db/repo/scenes'
import * as messagesRepo from '@main/db/repo/messages'
import * as memoriesRepo from '@main/db/repo/memories'
import * as settingsRepo from '@main/db/repo/settings'
import { runAutoTasks } from '@main/services/autoTasks'
import { resetOneShotsForTests } from '@main/ipc/oneShot'

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
let characterId: number

/** Adds n visible messages, which is what the cadence counts. */
function sendTurns(n: number): void {
  for (let i = 0; i < n; i += 1) {
    messagesRepo.addMessage({ sceneId, role: 'user', content: `turn ${i}` })
  }
}

beforeEach(() => {
  cleanup = useTempDataDir()
  mockedStream.mockReset()
  resetOneShotsForTests()
  const worldId = worlds.saveWorld({ name: 'Eden' })
  characterId = charactersRepo.saveCharacter({ worldId, name: 'Morgana' })
  sceneId = scenesRepo.saveScene({
    worldId,
    title: 'The rooftop',
    mode: 'roleplay',
    characterIds: [characterId]
  })
  answerWith('A summary of the scene.')
})

afterEach(() => cleanup())

const statuses: string[] = []
const collect = (s: string): void => {
  statuses.push(s)
}

beforeEach(() => {
  statuses.length = 0
})

describe('when the passes are off', () => {
  it('does nothing at all, however long the scene runs', async () => {
    sendTurns(50)
    const report = await runAutoTasks(sceneId, collect)
    expect(report).toEqual({ summarized: false, memoriesApproved: 0, problems: [] })
    expect(mockedStream).not.toHaveBeenCalled()
    expect(statuses).toEqual([])
  })
})

describe('the automatic summary', () => {
  beforeEach(() => {
    settingsRepo.saveSettings({ autoSummary: '1', autoSummaryEvery: '4' })
  })

  it('waits for the interval before it costs a request', async () => {
    sendTurns(3)
    expect((await runAutoTasks(sceneId, collect)).summarized).toBe(false)
    expect(mockedStream).not.toHaveBeenCalled()

    sendTurns(1)
    expect((await runAutoTasks(sceneId, collect)).summarized).toBe(true)
    expect(scenesRepo.getScene(sceneId)!.summary).toBe('A summary of the scene.')
    expect(statuses).toEqual(['summarizing'])
  })

  it('counts from where it last ran, not from every message', async () => {
    sendTurns(4)
    await runAutoTasks(sceneId, collect)
    expect(scenesRepo.getScene(sceneId)!.autoSummaryAt).toBe(4)

    sendTurns(2)
    expect((await runAutoTasks(sceneId, collect)).summarized).toBe(false)
    sendTurns(2)
    expect((await runAutoTasks(sceneId, collect)).summarized).toBe(true)
    expect(mockedStream).toHaveBeenCalledTimes(2)
  })

  it('reports a failure in words and does not retry every message after it', async () => {
    mockedStream.mockImplementation(async function* () {
      throw new Error('The endpoint is unreachable.')
      yield ''
    })
    sendTurns(4)
    const report = await runAutoTasks(sceneId, collect)
    expect(report.summarized).toBe(false)
    expect(report.problems[0]).toContain('The automatic summary did not run')
    expect(scenesRepo.getScene(sceneId)!.autoSummaryAt).toBe(4)

    sendTurns(1)
    await runAutoTasks(sceneId, collect)
    expect(mockedStream).toHaveBeenCalledTimes(1)
  })

  it('treats a nonsense interval as every message rather than never', async () => {
    settingsRepo.saveSettings({ autoSummaryEvery: 'soon' })
    sendTurns(1)
    expect((await runAutoTasks(sceneId, collect)).summarized).toBe(true)
  })
})

describe('the automatic memory pass', () => {
  beforeEach(() => {
    settingsRepo.saveSettings({ autoMemories: '1', autoMemoriesEvery: '2' })
  })

  it('approves what it proposes, so nothing waits for review', async () => {
    answerWith(
      '```memory_action\n' +
        JSON.stringify({
          type: 'create',
          character_id: characterId,
          memory_type: 'canon',
          content: 'Morgana admitted she was afraid.'
        }) +
        '\n```'
    )
    sendTurns(2)
    const report = await runAutoTasks(sceneId, collect)
    expect(report.memoriesApproved).toBe(1)
    expect(statuses).toEqual(['reading the scene'])
    expect(memoriesRepo.listMemories(characterId).map((m) => m.content)).toEqual([
      'Morgana admitted she was afraid.'
    ])
    expect(memoriesRepo.listCharacterProposals(characterId)).toHaveLength(0)
  })

  it('rewrites an existing memory rather than leaving both standing', async () => {
    const existing = memoriesRepo.saveMemory({
      characterId,
      type: 'relationship',
      content: 'Morgana barely tolerates the user.'
    })
    answerWith(
      '```memory_action\n' +
        JSON.stringify({
          type: 'replace',
          memory_id: existing,
          memory_type: 'relationship',
          content: 'Morgana trusts the user now.'
        }) +
        '\n```'
    )
    sendTurns(2)
    await runAutoTasks(sceneId, collect)
    const memories = memoriesRepo.listMemories(characterId)
    expect(memories).toHaveLength(1)
    expect(memories[0]!.content).toBe('Morgana trusts the user now.')
  })
})

describe('both passes on the same turn', () => {
  it('runs them in order and reports each as it starts', async () => {
    settingsRepo.saveSettings({
      autoSummary: '1',
      autoSummaryEvery: '2',
      autoMemories: '1',
      autoMemoriesEvery: '2'
    })
    sendTurns(2)
    await runAutoTasks(sceneId, collect)
    expect(statuses).toEqual(['summarizing', 'reading the scene'])
  })
})

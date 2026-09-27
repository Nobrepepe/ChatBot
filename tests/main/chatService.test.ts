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
    previouslyOn: 'A storm.',
    mode: 'roleplay',
    characterIds: [liraelId, morganaId]
  })
})

afterEach(() => cleanup())

describe('build', () => {
  it('appends a turn-control user message for respond-to-latest', () => {
    const result = chat.build(sceneId, {
      responder: { kind: 'character', characterId: morganaId },
      respondToLatest: true
    })
    const last = result.built.messages.at(-1)!
    expect(last.role).toBe('user')
    expect(last.content).toContain('[Turn control: Morgana now responds directly')
  })

  it('asks for an extra from the end of the prompt, leaving the system section alone', () => {
    const plain = chat.build(sceneId)
    const asExtra = chat.build(sceneId, { responder: { kind: 'extra', name: 'the driver' } })
    // The whole point: choosing a passer-by must not move token zero, or a
    // local server reprocesses the entire context to hear one line.
    expect(asExtra.built.messages[0]!.content).toBe(plain.built.messages[0]!.content)
    const last = asExtra.built.messages.at(-1)!
    expect(last.role).toBe('user')
    expect(last.content).toContain('not in the cast')
    expect(last.content).toContain('[The scene calls on: the driver.]')
    expect(asExtra.responder).toEqual({ kind: 'extra', name: 'the driver' })
    expect(asExtra.lead.id).toBe(liraelId)
  })

  it('keeps the prompt written around the standing responder while an extra speaks', () => {
    const asKaguya = chat.build(sceneId, {
      responder: { kind: 'character', characterId: morganaId }
    })
    const asExtra = chat.build(sceneId, {
      responder: { kind: 'extra', name: 'the barman', leadId: morganaId }
    })
    // Sending a message and then asking a passer-by to chime in must not
    // reprocess the whole context, so token zero has to survive the switch.
    expect(asExtra.built.messages[0]!.content).toBe(asKaguya.built.messages[0]!.content)
    expect(asExtra.built.messages[0]!.content).toContain('only "Morgana" may respond')
    expect(asExtra.lead.id).toBe(morganaId)
  })

  it('offers the extras still in the window back to the model', () => {
    messagesRepo.addMessage({
      sceneId,
      role: 'extra',
      speakerName: 'Taxi driver',
      content: '"Where to?"'
    })
    const result = chat.build(sceneId, { responder: { kind: 'extra' } })
    expect(result.built.messages.at(-1)!.content).toContain('{Taxi driver}')
    // And the transcript now labels every voice, single cast or not.
    expect(result.built.messages[1]!.content).toBe('{Taxi driver} "Where to?"')
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
    const buildResult = chat.build(sceneId, {
      responder: { kind: 'character', characterId: morganaId }
    })
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
    const buildResult = chat.build(sceneId, {
      responder: { kind: 'character', characterId: liraelId }
    })
    const saved = chat.saveReply(sceneId, 'Just words.', buildResult)
    expect(saved.characterId).toBe(liraelId)
    expect(saved.content).toBe('Just words.')
  })
})

describe('saveReply for an extra', () => {
  const asExtra = (name = ''): chat.BuildResult =>
    chat.build(sceneId, { responder: { kind: 'extra', name } })

  it('keeps a name the app has never seen', () => {
    const saved = chat.saveReply(sceneId, '{Taxi driver} "Where to, then?"', asExtra())
    expect(saved.characterId).toBeNull()
    expect(saved.speakerName).toBe('Taxi driver')
    expect(saved.content).toBe('"Where to, then?"')
    const stored = messagesRepo.getMessage(saved.messageId)!
    expect(stored.role).toBe('extra')
    expect(stored.speakerName).toBe('Taxi driver')
  })

  it('strips a sprite tag it has no sprites for', () => {
    const saved = chat.saveReply(sceneId, '{Barman} [wry] "We close at two."', asExtra())
    expect(saved.emotion).toBe('')
    expect(saved.content).toBe('"We close at two."')
  })

  it('falls back to the hint, then to a plain label, when no name arrives', () => {
    expect(chat.saveReply(sceneId, 'Mind the step.', asExtra('the doorman')).speakerName).toBe(
      'the doorman'
    )
    expect(chat.saveReply(sceneId, 'Mind the step.', asExtra()).speakerName).toBe(
      chat.UNNAMED_EXTRA
    )
  })

  it('takes the model at its word when it answered as a cast member instead', () => {
    const saved = chat.saveReply(sceneId, '{Morgana} "I will handle this."', asExtra())
    expect(saved.characterId).toBe(morganaId)
    expect(saved.speakerName).toBe('')
    expect(messagesRepo.getMessage(saved.messageId)!.role).toBe('character')
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
    await chat.proposeMemories(sceneId, controller.signal)
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

  it('proposes nothing when the generation is aborted', async () => {
    mockedStream.mockImplementation(async function* () {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      yield ''
    })
    await expect(chat.proposeMemories(sceneId, new AbortController().signal)).rejects.toThrow('aborted')
    expect(memoriesRepo.listCharacterProposals(morganaId)).toHaveLength(0)
    expect(memoriesRepo.listMemories(morganaId, { lifecycle: 'any' })).toHaveLength(0)
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

  it('credits an extra with their own line', async () => {
    const { readFileSync } = await import('node:fs')
    messagesRepo.addMessage({
      sceneId,
      role: 'extra',
      speakerName: 'Taxi driver',
      content: '"Where to, then?"'
    })
    messagesRepo.addMessage({ sceneId, role: 'extra', content: '"Mind the step."' })

    const text = readFileSync(chat.exportScene(sceneId), 'utf8')
    expect(text).toContain('**Taxi driver:** "Where to, then?"')
    expect(text).toContain(`**${chat.UNNAMED_EXTRA}:** "Mind the step."`)
  })
})

describe('proposeMemories', () => {
  function action(payload: Record<string, unknown>): string {
    return '```memory_action\n' + JSON.stringify(payload) + '\n```'
  }

  it('proposes a create as a memory that is not canon until approved', async () => {
    answerWith(
      'Two things changed.\n\n' +
        action({
          type: 'create',
          character_id: morganaId,
          memory_type: 'canon',
          content: 'Morgana admitted she was afraid.'
        })
    )
    const proposals = await chat.proposeMemories(sceneId)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({
      actionType: 'create',
      characterId: morganaId,
      characterName: 'Morgana',
      proposedContent: 'Morgana admitted she was afraid.',
      status: 'pending'
    })
    // The row exists so the next pass can revise this same id, but it is not
    // sent with any prompt yet.
    expect(memoriesRepo.listMemories(morganaId)).toHaveLength(0)
    expect(memoriesRepo.listMemories(morganaId, { lifecycle: 'proposed' })).toHaveLength(1)
  })

  it('rewrites an existing memory instead of stacking a second one', async () => {
    const existing = memoriesRepo.saveMemory({
      characterId: morganaId,
      type: 'relationship',
      content: 'Morgana barely tolerates the user.'
    })
    answerWith(
      action({
        type: 'replace',
        memory_id: existing,
        memory_type: 'relationship',
        content: 'Morgana trusts the user now.'
      })
    )
    const [proposal] = await chat.proposeMemories(sceneId)
    expect(proposal).toMatchObject({
      actionType: 'replace',
      targetMemoryId: existing,
      currentContent: 'Morgana barely tolerates the user.',
      proposedContent: 'Morgana trusts the user now.'
    })
    // Until approved the old memory is still the one being sent.
    expect(memoriesRepo.listMemories(morganaId)[0]!.content).toBe(
      'Morgana barely tolerates the user.'
    )

    memoriesRepo.approveMemorySuggestion(proposal!.id, proposal!.proposedContent, 'relationship')
    const after = memoriesRepo.listMemories(morganaId)
    expect(after).toHaveLength(1)
    expect(after[0]!.content).toBe('Morgana trusts the user now.')
  })

  it('proposes forgetting a memory that has become false', async () => {
    const existing = memoriesRepo.saveMemory({
      characterId: liraelId,
      type: 'canon',
      content: 'Lirael cannot swim.'
    })
    answerWith(action({ type: 'forget', memory_id: existing, reason: 'She learned this spring.' }))
    const [proposal] = await chat.proposeMemories(sceneId)
    expect(proposal).toMatchObject({ actionType: 'forget', targetMemoryId: existing })
    expect(memoriesRepo.listMemories(liraelId)).toHaveLength(1)

    memoriesRepo.approveMemorySuggestion(proposal!.id, '', 'canon')
    expect(memoriesRepo.listMemories(liraelId, { lifecycle: 'any' })).toHaveLength(0)
  })

  it('refuses an id the character does not own', async () => {
    answerWith(action({ type: 'replace', memory_id: 9999, content: 'Invented.' }))
    expect(await chat.proposeMemories(sceneId)).toHaveLength(0)
  })

  it('shows the model what it already proposed, so a second pass revises it', async () => {
    answerWith(
      action({
        type: 'create',
        character_id: morganaId,
        memory_type: 'canon',
        content: 'Morgana admitted she was afraid.'
      })
    )
    const [first] = await chat.proposeMemories(sceneId)

    let seen = ''
    mockedStream.mockImplementation(async function* (messages) {
      seen = messages[0]!.content
      yield action({
        type: 'replace',
        memory_id: first!.targetMemoryId,
        memory_type: 'canon',
        content: 'Morgana admitted she was afraid of the water.'
      })
    })
    const [second] = await chat.proposeMemories(sceneId)
    expect(seen).toContain('Proposals still awaiting the user')
    expect(second!.actionType).toBe('replace')
    // The earlier proposal steps aside rather than waiting beside its revision.
    expect(memoriesRepo.listCharacterProposals(morganaId)).toHaveLength(1)
  })

  it('does not propose a fact the character already carries word for word', async () => {
    memoriesRepo.saveMemory({
      characterId: morganaId,
      type: 'canon',
      content: 'Morgana admitted she was afraid.'
    })
    answerWith(
      action({
        type: 'create',
        character_id: morganaId,
        memory_type: 'canon',
        content: '  morgana  admitted she was AFRAID. '
      })
    )
    expect(await chat.proposeMemories(sceneId)).toHaveLength(0)
    expect(memoriesRepo.listMemories(morganaId, { lifecycle: 'any' })).toHaveLength(1)
  })

  it('does not propose a rewrite into the words already there', async () => {
    const existing = memoriesRepo.saveMemory({
      characterId: morganaId,
      type: 'relationship',
      content: 'Morgana trusts the user now.'
    })
    answerWith(
      action({
        type: 'replace',
        memory_id: existing,
        memory_type: 'relationship',
        content: 'Morgana trusts the user now.'
      })
    )
    expect(await chat.proposeMemories(sceneId)).toHaveLength(0)
  })

  it('does not propose the same new fact twice across passes', async () => {
    answerWith(
      action({
        type: 'create',
        character_id: morganaId,
        memory_type: 'canon',
        content: 'Morgana admitted she was afraid.'
      })
    )
    expect(await chat.proposeMemories(sceneId)).toHaveLength(1)
    expect(await chat.proposeMemories(sceneId)).toHaveLength(0)
    expect(memoriesRepo.listCharacterProposals(morganaId)).toHaveLength(1)
  })

  it('still reads a plain bullet list from a model that ignores the contract', async () => {
    answerWith('- Morgana admitted she was afraid.\n- The rooftop is Lirael\'s refuge.\nnot a bullet')
    const proposals = await chat.proposeMemories(sceneId)
    expect(proposals).toHaveLength(2)
    expect(proposals[0]!.characterId).toBe(morganaId)
    expect(proposals[1]!.characterId).toBe(liraelId)
    expect(proposals.every((p) => p.actionType === 'create')).toBe(true)
  })
})

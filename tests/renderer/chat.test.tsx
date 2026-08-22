import { describe, it, expect, beforeEach } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  installFakeApi,
  makeCharacter,
  makeMessage,
  makeScene,
  makeWorld,
  type FakeApi
} from './fakeApi'
import { renderRoute } from './renderRoute'

let api: FakeApi

function seed(over: { characterIds?: number[]; messages?: ReturnType<typeof makeMessage>[] } = {}): void {
  api = installFakeApi({
    worlds: [makeWorld({ id: 1 })],
    characters: [
      makeCharacter({ id: 10, worldId: 1, name: 'Ayame' }),
      makeCharacter({ id: 11, worldId: 1, name: 'Kaguya' })
    ],
    scenes: [makeScene({ id: 5, worldId: 1, characterIds: over.characterIds ?? [10] })],
    messages: over.messages ?? []
  })
}

const composer = (): HTMLElement => screen.getByPlaceholderText('Say something')

/** Push a streaming chunk from the fake main process. */
async function chunk(text: string): Promise<void> {
  await act(async () => {
    api.chunk(api.lastRequestId, text)
  })
}
async function finish(): Promise<void> {
  await act(async () => {
    api.done(api.lastRequestId)
  })
}

describe('the composer', () => {
  beforeEach(() => seed())

  it('sends on Enter', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'I came looking for you.')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    const [params] = api.callsTo('chat:start')[0] as [any]
    expect(params).toMatchObject({
      kind: 'reply',
      sceneId: 5,
      userMessage: 'I came looking for you.'
    })
    expect(composer()).toHaveValue('')
  })

  it('makes a new line on Shift+Enter instead of sending', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'first')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await userEvent.type(composer(), 'second')
    expect(api.callsTo('chat:start')).toHaveLength(0)
    expect(composer()).toHaveValue('first\nsecond')
  })

  it('says how the keys work', async () => {
    renderRoute('/chat/5')
    expect(await screen.findByText('Enter sends · Shift+Enter makes a new line')).toBeInTheDocument()
  })

  it('ignores an empty message', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: /Send/ }))
    expect(api.callsTo('chat:start')).toHaveLength(0)
  })
})

describe('streaming a reply', () => {
  beforeEach(() => seed())

  it('shows the text as it arrives, then who is answering', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'hello')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))

    await chunk('She looks up slowly')
    expect(screen.getByText(/She looks up slowly/)).toBeInTheDocument()
    expect(screen.getByText('answering')).toBeInTheDocument()
  })

  it('offers Stop while generating and cancels the request', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'hello')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))

    const stop = await screen.findByRole('button', { name: /Stop/ })
    await userEvent.click(stop)
    expect(api.callsTo('chat:cancel')).toHaveLength(1)
  })

  it('returns to Send once the reply finishes', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'hello')
    await userEvent.keyboard('{Enter}')
    await chunk('done talking')
    await finish()
    await waitFor(() => expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument())
    expect(screen.queryByText('answering')).not.toBeInTheDocument()
  })

  it('surfaces a generation failure without losing the screen', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'hello')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    await act(async () => {
      api.fail(api.lastRequestId, 'Could not connect to the model.')
    })
    expect(await screen.findByText('Could not connect to the model.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument()
  })
})

describe('a multi-character scene', () => {
  beforeEach(() => seed({ characterIds: [10, 11] }))

  it('flips the speaker mid-stream when a {Name} tag arrives', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'who is there?')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))

    await chunk('{Kaguya} "I heard something below."')
    // The header follows the tag, and the tag itself never reaches the reader.
    expect(screen.getByText('Kaguya')).toBeInTheDocument()
    expect(screen.getByText(/I heard something below/)).toBeInTheDocument()
    expect(screen.queryByText(/\{Kaguya\}/)).not.toBeInTheDocument()
  })

  it('lets a character answer the previous reply directly', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: /Choose responder/ }))
    // Picking marks the character without dismissing the overlay, so the
    // confirm action names whoever was just chosen.
    await userEvent.click(await screen.findByRole('button', { name: /Kaguya waiting/ }))
    expect(screen.getByRole('button', { name: /Kaguya responds next/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Respond as Kaguya/ }))

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    const [params] = api.callsTo('chat:start')[0] as [any]
    expect(params).toMatchObject({ kind: 'reply', responderId: 11, respondToLatest: true })
    expect(params.userMessage).toBeUndefined()
  })

  it('offers no responder picker for a single character', async () => {
    seed({ characterIds: [10] })
    renderRoute('/chat/5')
    await screen.findByPlaceholderText('Say something')
    expect(screen.queryByRole('button', { name: /Choose responder/ })).not.toBeInTheDocument()
  })
})

describe('turns already in the transcript', () => {
  beforeEach(() =>
    seed({
      messages: [
        makeMessage({ id: 100, sceneId: 5, role: 'user', content: 'I came looking for you.' }),
        makeMessage({ id: 101, sceneId: 5, role: 'character', characterId: 10, content: '"You found me."' })
      ]
    })
  )

  it('typesets each turn under its speaker', async () => {
    renderRoute('/chat/5')
    expect(await screen.findByText('I came looking for you.')).toBeInTheDocument()
    expect(screen.getByText('"You found me."')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Ayame')).toBeInTheDocument()
  })

  it('edits a turn in place', async () => {
    renderRoute('/chat/5')
    await screen.findByText('"You found me."')
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]!)
    const field = await screen.findByLabelText('Message')
    await userEvent.clear(field)
    await userEvent.type(field, '"You came."')
    await userEvent.click(screen.getByRole('button', { name: /Save the message/ }))
    await waitFor(() => expect(api.callsTo('messages:update')).toContainEqual([101, '"You came."']))
  })

  it('continues a trimmed reply from where it stops', async () => {
    renderRoute('/chat/5')
    await screen.findByText('"You found me."')
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]!)
    await userEvent.click(await screen.findByRole('button', { name: /Save & continue/ }))

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    const [params] = api.callsTo('chat:start')[0] as [any]
    expect(params).toMatchObject({ kind: 'continuation', messageId: 101, partial: '"You found me."' })
  })

  it('confirms before removing a turn', async () => {
    renderRoute('/chat/5')
    await screen.findByText('"You found me."')
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!)
    expect(await screen.findByText('It will no longer be sent to the model.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Remove the turn/ }))
    await waitFor(() => expect(api.callsTo('messages:delete')).toContainEqual([101]))
  })

  it('saves a reply as canon from the transcript', async () => {
    renderRoute('/chat/5')
    await screen.findByText('"You found me."')
    await userEvent.click(screen.getByRole('button', { name: 'Remember' }))
    await userEvent.click(await screen.findByRole('button', { name: /Keep this memory/ }))
    await waitFor(() => expect(api.callsTo('memories:save')).toHaveLength(1))
    const [draft] = api.callsTo('memories:save')[0] as [any]
    expect(draft).toMatchObject({ characterId: 10, type: 'canon', sourceSceneId: 5 })
  })

  it('offers no Remember on the writer’s own turn', async () => {
    renderRoute('/chat/5')
    await screen.findByText('I came looking for you.')
    expect(screen.getAllByRole('button', { name: 'Remember' })).toHaveLength(1)
  })

  it('drops the last reply before regenerating', async () => {
    renderRoute('/chat/5')
    await screen.findByText('"You found me."')
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(api.callsTo('messages:delete')).toContainEqual([101]))
    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
  })

  it('reports how much of the history is actually being sent', async () => {
    api.store.settings.historyLimit = '1'
    renderRoute('/chat/5')
    expect(await screen.findByText(/of 2 messages are being sent/)).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})

describe('display modes', () => {
  beforeEach(() =>
    seed({
      messages: [
        makeMessage({ id: 100, sceneId: 5, role: 'user', content: 'I came looking for you.' }),
        makeMessage({ id: 101, sceneId: 5, role: 'character', characterId: 10, content: '"You found me."' })
      ]
    })
  )

  it('remembers the mode per scene rather than globally', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Visual novel' }))
    await waitFor(() => expect(api.callsTo('scenes:setDisplayMode')).toContainEqual([5, 'vn']))
  })

  it('shows the backlog only in visual novel mode', async () => {
    api.store.scenes[0]!.displayMode = 'vn'
    renderRoute('/chat/5')
    expect(await screen.findByRole('button', { name: 'Backlog' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    const dialog = await screen.findByRole('dialog', { name: 'Everything said so far.' })
    expect(within(dialog).getByText('I came looking for you.')).toBeInTheDocument()
  })

  it('stages only the latest line in visual novel mode', async () => {
    api.store.scenes[0]!.displayMode = 'vn'
    renderRoute('/chat/5')
    expect(await screen.findByText('"You found me."')).toBeInTheDocument()
    expect(screen.getByText('You: I came looking for you.')).toBeInTheDocument()
  })
})

describe('scene tools', () => {
  beforeEach(() => seed({ messages: [makeMessage({ id: 100, sceneId: 5 })] }))

  it('summarizes into an overlay', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Summarize' }))
    expect(await screen.findByRole('dialog', { name: 'What this scene now remembers.' })).toBeInTheDocument()
    expect(screen.getByText('A summary.')).toBeInTheDocument()
  })

  it('exports the transcript and says where it landed', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))
    expect(await screen.findByText(/Transcript saved to \/tmp\/exports\/scene_1\.md/)).toBeInTheDocument()
  })

  it('shows the exact payload behind the prompt debug panel', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Prompt debug' }))
    expect(
      await screen.findByRole('dialog', { name: 'What the model is actually sent.' })
    ).toBeInTheDocument()
    expect(await screen.findByText('System instructions')).toBeInTheDocument()
  })

  it('reports nothing worth remembering rather than an empty overlay', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Suggest memories' }))
    expect(await screen.findByText('Nothing stood out as worth remembering.')).toBeInTheDocument()
  })
})

describe('a conversation pinned to older canon', () => {
  it('offers to move it once the active publication has moved on', async () => {
    seed()
    api.store.hub = {
      hubMode: true,
      publicationId: 'pub-2',
      receipt: null,
      previousPublicationId: 'pub-1',
      linkedFolder: ''
    }
    api.store.scenes[0]!.publicationId = 'pub-1'
    renderRoute('/chat/5')
    expect(
      await screen.findByText('This conversation is pinned to the canon it began with.')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Move it to the current canon/ }))
    await waitFor(() => expect(api.callsTo('hub:migrateScene')).toContainEqual([5]))
  })

  it('stays quiet when the conversation is already on the current canon', async () => {
    seed()
    api.store.hub = {
      hubMode: true,
      publicationId: 'pub-2',
      receipt: null,
      previousPublicationId: null,
      linkedFolder: ''
    }
    api.store.scenes[0]!.publicationId = 'pub-2'
    renderRoute('/chat/5')
    await screen.findByPlaceholderText('Say something')
    expect(screen.queryByText(/pinned to the canon/)).not.toBeInTheDocument()
  })
})

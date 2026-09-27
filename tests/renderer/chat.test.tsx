import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  installFakeApi,
  makeCharacter,
  makeMessage,
  makeProposal,
  makeScene,
  makeWorld,
  type FakeApi
} from './fakeApi'
import { renderRoute } from './renderRoute'
import { contentResized } from './setup'

let api: FakeApi

function seed(
  over: { characterIds?: number[]; messages?: ReturnType<typeof makeMessage>[] } = {}
): void {
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

const castTile = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`${name}\\s*(in|not in) this scene`) })

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

const transcript = (): HTMLElement => {
  const el = document.querySelector('.transcript')
  if (!el) throw new Error('no transcript on screen')
  return el as HTMLElement
}

/**
 * jsdom has no layout, so a scroll region has to be described to it. The stub
 * goes on every div: the transcript is created by the render, well after the
 * test could reach for it, and it is the only element the hook ever scrolls.
 * The document is not a div, which is the point — the screen now fits the
 * window, so the page must stay where it is.
 */
function describeScrollRegions(scrollHeight = 2000, clientHeight = 800): void {
  for (const [prop, value] of [
    ['scrollHeight', scrollHeight],
    ['clientHeight', clientHeight]
  ] as const) {
    Object.defineProperty(HTMLDivElement.prototype, prop, { value, configurable: true })
  }
}

function forgetScrollRegions(): void {
  for (const prop of ['scrollHeight', 'clientHeight']) {
    delete (HTMLDivElement.prototype as unknown as Record<string, unknown>)[prop]
  }
}

/** Move the reader's own scroll position, the way the browser reports it. */
function scrollTranscriptTo(top: number): void {
  transcript().scrollTop = top
  fireEvent.scroll(transcript())
}

/** Reach one of the actions that live behind “Scene actions →”. */
async function sceneAction(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Scene actions →' }))
  await userEvent.click(await screen.findByRole('button', { name }))
}

/** A document tall enough to scroll, so a page that moves is a real failure. */
function makePageScrollable(scrollHeight = 2000, clientHeight = 800): void {
  for (const [prop, value] of [
    ['scrollHeight', scrollHeight],
    ['clientHeight', clientHeight]
  ] as const) {
    Object.defineProperty(document.documentElement, prop, { value, configurable: true })
  }
  document.documentElement.scrollTop = 0
}

describe('entering a scene', () => {
  beforeEach(() => {
    seed({
      messages: Array.from({ length: 40 }, (_, i) =>
        makeMessage({ id: 200 + i, sceneId: 5, content: `line ${i}` })
      )
    })
    describeScrollRegions()
  })

  afterEach(forgetScrollRegions)

  it('lands on the last message instead of the top of the backlog', async () => {
    renderRoute('/chat/5')
    await screen.findByText('line 39')
    await waitFor(() => expect(transcript().scrollTop).toBe(2000))
  })

  it('lands on the last message even when the scene resolves after its messages', async () => {
    // The screen has no transcript until the scene itself arrives, so a scene
    // that loses the race to its own message list used to spend the one entry
    // scroll on nothing and open at the top of the backlog.
    api.defer('scenes:get')
    renderRoute('/chat/5')
    await waitFor(() => expect(api.callsTo('messages:list').length).toBeGreaterThan(0))
    api.release('scenes:get')
    await screen.findByText('line 39')
    await waitFor(() => expect(transcript().scrollTop).toBe(2000))
  })

  it('lands again on a transcript that was torn down and rebuilt', async () => {
    // Leaving for the visual novel and coming back destroys the scroll region
    // and builds a fresh one, which is also what StrictMode does on mount. The
    // new element has no scroll position of its own, so entry is owed again.
    renderRoute('/chat/5')
    await waitFor(() => expect(transcript().scrollTop).toBe(2000))
    await sceneAction('Visual novel →')
    await waitFor(() => expect(document.querySelector('.transcript')).toBeNull())
    await sceneAction('Rolling chat →')
    await waitFor(() => expect(transcript().scrollTop).toBe(2000))
  })

  it('lands whenever the content first has a height, without being told', async () => {
    // Whatever delays the layout — the stylesheet arriving, a font settling, a
    // portrait resolving — reaches the pin as the same event: the content it
    // watches changed size. Nothing has to know which of them it was.
    forgetScrollRegions()
    renderRoute('/chat/5')
    await screen.findByText('line 39')
    expect(transcript().scrollTop).toBe(0)

    describeScrollRegions()
    act(() => contentResized())
    expect(transcript().scrollTop).toBe(2000)
  })

  it('scrolls the transcript and never the page', async () => {
    // The actions and the composer are outside the transcript; if the document
    // moved, they would leave the frame with the backlog.
    makePageScrollable()
    renderRoute('/chat/5')
    await screen.findByText('line 39')
    await waitFor(() => expect(transcript().scrollTop).toBe(2000))
    expect(document.documentElement.scrollTop).toBe(0)
  })

  it('follows a streaming reply while the reader is at the bottom', async () => {
    renderRoute('/chat/5')
    await screen.findByText('line 39')
    await waitFor(() => expect(transcript().scrollTop).toBe(2000))
    // Still within a line or two of the newest message.
    scrollTranscriptTo(1150)
    await userEvent.type(composer(), 'Hello.')
    await userEvent.keyboard('{Enter}')
    await chunk('She looks up.')
    act(() => contentResized())
    expect(transcript().scrollTop).toBe(2000)
  })

  it('leaves the reader alone once they have scrolled back into the scene', async () => {
    renderRoute('/chat/5')
    await screen.findByText('line 39')
    await waitFor(() => expect(transcript().scrollTop).toBe(2000))
    scrollTranscriptTo(200)
    await userEvent.type(composer(), 'Hello.')
    await userEvent.keyboard('{Enter}')
    await chunk('She looks up.')
    await screen.findByText(/She looks up/)
    // The reply grows the transcript under them, and it is still declined.
    act(() => contentResized())
    expect(transcript().scrollTop).toBe(200)
  })
})

describe('the composer', () => {
  beforeEach(() => seed())

  it('sends on Enter', async () => {
    renderRoute('/chat/5')
    await userEvent.type(
      await screen.findByPlaceholderText('Say something'),
      'I came looking for you.'
    )
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
    expect(
      await screen.findByText('Enter sends · Shift+Enter makes a new line')
    ).toBeInTheDocument()
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

  it('chooses the next responder in the rail without generating anything', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Next: Ayame' }))
    await userEvent.click(await screen.findByRole('button', { name: /Kaguya waiting/ }))

    // Selection alone is not a generation; it only renames the next turn.
    expect(api.callsTo('chat:start')).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: /Kaguya answers the next user turn/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next: Kaguya' })).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Say something'), 'who is there?')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    expect(api.callsTo('chat:start')[0]![0]).toMatchObject({
      responder: { kind: 'character', characterId: 11 }
    })
  })

  it('lets a character answer the previous reply directly', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Next: Ayame' }))
    await userEvent.click(await screen.findByRole('button', { name: /Kaguya waiting/ }))
    await userEvent.click(screen.getByRole('button', { name: /Let Kaguya answer now/ }))

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    const [params] = api.callsTo('chat:start')[0] as [any]
    expect(params).toMatchObject({
      kind: 'reply',
      responder: { kind: 'character', characterId: 11 },
      respondToLatest: true
    })
    expect(params.userMessage).toBeUndefined()
    // Generation begins with the transcript back at full width.
    expect(screen.queryByRole('button', { name: /Let Kaguya answer now/ })).not.toBeInTheDocument()
  })

  it('hides the rail on Escape', async () => {
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Next: Ayame' }))
    expect(await screen.findByText('Ayame will answer next.')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Ayame will answer next.')).not.toBeInTheDocument()
  })

  it('still opens the rail for a single character, who is no longer the only voice', async () => {
    seed({ characterIds: [10] })
    renderRoute('/chat/5')
    await screen.findByPlaceholderText('Say something')
    await userEvent.click(await screen.findByRole('button', { name: 'Next: Ayame' }))
    expect(await screen.findByText('Ayame will answer next.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extras →' })).toBeInTheDocument()
  })
})

describe('turns already in the transcript', () => {
  beforeEach(() =>
    seed({
      messages: [
        makeMessage({ id: 100, sceneId: 5, role: 'user', content: 'I came looking for you.' }),
        makeMessage({
          id: 101,
          sceneId: 5,
          role: 'character',
          characterId: 10,
          content: '"You found me."'
        })
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
    expect(params).toMatchObject({
      kind: 'continuation',
      messageId: 101,
      partial: '"You found me."'
    })
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
        makeMessage({
          id: 101,
          sceneId: 5,
          role: 'character',
          characterId: 10,
          content: '"You found me."'
        })
      ]
    })
  )

  it('remembers the mode per scene rather than globally', async () => {
    renderRoute('/chat/5')
    await sceneAction('Visual novel →')
    await waitFor(() => expect(api.callsTo('scenes:setDisplayMode')).toContainEqual([5, 'vn']))
  })

  it('shows the backlog only in visual novel mode', async () => {
    api.store.scenes[0]!.displayMode = 'vn'
    renderRoute('/chat/5')
    await sceneAction('Backlog →')
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
    expect(
      await screen.findByRole('dialog', { name: 'What this scene now remembers.' })
    ).toBeInTheDocument()
    expect(screen.getByText('A summary.')).toBeInTheDocument()
  })

  it('exports the transcript and says where it landed', async () => {
    renderRoute('/chat/5')
    await sceneAction('Export →')
    expect(
      await screen.findByText(/Transcript saved to \/tmp\/exports\/scene_1\.md/)
    ).toBeInTheDocument()
  })

  it('shows the exact payload behind the prompt debug panel', async () => {
    renderRoute('/chat/5')
    await sceneAction('Prompt debug →')
    expect(
      await screen.findByRole('dialog', { name: 'What the model is actually sent.' })
    ).toBeInTheDocument()
    expect(await screen.findByText('System instructions')).toBeInTheDocument()
  })

  it('reports nothing worth remembering rather than an empty overlay', async () => {
    renderRoute('/chat/5')
    await sceneAction('Suggest memories →')
    expect(
      await screen.findByText('Nothing in the scene changed what they carry.')
    ).toBeInTheDocument()
  })

  it('opens proposed memory changes for review rather than writing them', async () => {
    api.store.proposals.push(
      makeProposal({
        id: 40,
        sceneId: 5,
        characterId: 10,
        characterName: 'Ayame',
        actionType: 'replace',
        targetMemoryId: 30,
        currentContent: 'She barely tolerates you.',
        proposedContent: 'She trusts you now.',
        memoryType: 'relationship'
      })
    )
    renderRoute('/chat/5')
    await sceneAction('Suggest memories →')
    expect(
      await screen.findByRole('dialog', { name: 'Review what they would remember.' })
    ).toBeInTheDocument()
    expect(screen.getByText('She barely tolerates you.')).toBeInTheDocument()
    expect(screen.getByText('She trusts you now.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Keep it/ }))
    await waitFor(() => expect(api.callsTo('memories:approveSuggestion')).toHaveLength(1))
  })

  it('carries a summary into the next scene in the series', async () => {
    api.store.scenes[0]!.title = 'The rooftop'
    const view = renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Summarize' }))
    await userEvent.click(await screen.findByRole('button', { name: /Continue as a new scene/ }))
    await waitFor(() => expect(view.path()).toBe('/world/1/scene/new'))
    expect(await screen.findByLabelText('Title')).toHaveValue('The rooftop - Part II')
    expect(screen.getByLabelText('Previously on')).toHaveValue('A summary.')
    expect(castTile('Ayame')).toHaveTextContent('in this scene')
  })
})

describe('extras — the people the scene put within earshot', () => {
  const openRail = async (): Promise<void> => {
    await userEvent.click(await screen.findByRole('button', { name: /^Next:/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Extras →' }))
  }

  it('keeps the extras one step in, so the cast has the rail', async () => {
    seed()
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: /^Next:/ }))
    expect(await screen.findByText('Ayame will answer next.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Who speaks — optional')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Extras →' }))
    expect(screen.getByLabelText('Who speaks — optional')).toBeInTheDocument()
    expect(screen.queryByText('Ayame will answer next.')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '← Cast' }))
    expect(screen.getByText('Ayame will answer next.')).toBeInTheDocument()
  })

  it('closes the extras before the cast on Escape', async () => {
    seed()
    renderRoute('/chat/5')
    await openRail()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByText('Ayame will answer next.')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Ayame will answer next.')).not.toBeInTheDocument()

    // Opened again, the rail starts from the cast.
    await userEvent.click(screen.getByRole('button', { name: /^Next:/ }))
    expect(await screen.findByText('Ayame will answer next.')).toBeInTheDocument()
  })

  it('asks for someone else without adding a user turn', async () => {
    seed()
    renderRoute('/chat/5')
    await openRail()
    await userEvent.click(screen.getByRole('button', { name: /Let someone else answer now/ }))

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    const [params] = api.callsTo('chat:start')[0] as [any]
    expect(params).toMatchObject({
      kind: 'reply',
      responder: { kind: 'extra', name: '' },
      respondToLatest: true
    })
    expect(params.userMessage).toBeUndefined()
  })

  it('passes on who the writer asked for', async () => {
    seed()
    renderRoute('/chat/5')
    await openRail()
    await userEvent.type(screen.getByLabelText('Who speaks — optional'), 'the driver')
    await userEvent.click(screen.getByRole('button', { name: /Let someone else answer now/ }))

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    expect(api.callsTo('chat:start')[0]![0]).toMatchObject({
      responder: { kind: 'extra', name: 'the driver', leadId: 10 }
    })
  })

  it('sends what is in the composer, so the extra answers it', async () => {
    seed()
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'take me downtown')
    await openRail()
    await userEvent.click(screen.getByRole('button', { name: /Let someone else answer now/ }))

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    expect(api.callsTo('chat:start')[0]![0]).toMatchObject({
      userMessage: 'take me downtown',
      responder: { kind: 'extra' },
      respondToLatest: false
    })
  })

  it('names the extra over their turn, and keeps offering them', async () => {
    seed({
      messages: [
        makeMessage({ id: 100, sceneId: 5, role: 'user', content: 'Where to?' }),
        makeMessage({
          id: 101,
          sceneId: 5,
          role: 'extra',
          speakerName: 'Taxi driver',
          content: '"Downtown it is."'
        })
      ]
    })
    renderRoute('/chat/5')
    expect(await screen.findByText('Taxi driver')).toBeInTheDocument()
    expect(screen.getByText(/Downtown it is/)).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /^Next:/ }))
    // The cast says who is still around without opening the extras.
    const extras = screen.getByRole('button', { name: 'Extras →' })
    expect(extras).toHaveAttribute('title', 'Taxi driver is still within earshot')
    await userEvent.click(extras)
    expect(
      screen.getByRole('button', { name: /Let taxi driver answer now/ })
    ).toBeInTheDocument()
  })

  it('shows the improvised name as it streams in, not the character’s', async () => {
    seed()
    renderRoute('/chat/5')
    await openRail()
    await userEvent.click(screen.getByRole('button', { name: /Let someone else answer now/ }))
    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))

    await chunk('{Taxi driver} "Where to, then?"')
    expect(screen.getByText('Taxi driver')).toBeInTheDocument()
    expect(screen.queryByText(/\{Taxi driver\}/)).not.toBeInTheDocument()
    expect(screen.getByText(/Where to, then/)).toBeInTheDocument()
  })

  it('regenerates an extra as that same extra, never as the cast', async () => {
    seed({
      messages: [
        makeMessage({
          id: 101,
          sceneId: 5,
          role: 'extra',
          speakerName: 'Taxi driver',
          content: '"Downtown it is."'
        })
      ]
    })
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    expect(api.callsTo('chat:start')[0]![0]).toMatchObject({
      responder: { kind: 'extra', name: 'Taxi driver' }
    })
  })

  it('renames a drifting extra everywhere in the scene', async () => {
    seed({
      messages: [
        makeMessage({
          id: 101,
          sceneId: 5,
          role: 'extra',
          speakerName: 'The driver',
          content: '"Downtown it is."'
        }),
        makeMessage({
          id: 102,
          sceneId: 5,
          role: 'extra',
          speakerName: 'The driver',
          content: '"Traffic is bad."'
        })
      ]
    })
    renderRoute('/chat/5')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    const field = await screen.findByLabelText('Who is speaking')
    await userEvent.clear(field)
    await userEvent.type(field, 'Taxi driver')
    await userEvent.click(screen.getByRole('button', { name: /Save the message/ }))

    await waitFor(() =>
      expect(api.callsTo('messages:renameExtra')).toEqual([[5, 'The driver', 'Taxi driver']])
    )
    expect(await screen.findAllByText('Taxi driver')).toHaveLength(2)
  })
})

describe('inviting a character', () => {
  beforeEach(() => seed({ messages: [makeMessage({ id: 100, sceneId: 5 })] }))

  it('offers only the characters who are not already here', async () => {
    renderRoute('/chat/5')
    await sceneAction('Invite character →')
    const dialog = await screen.findByRole('dialog', { name: 'Who else is here?' })
    expect(within(dialog).getByRole('button', { name: /Kaguya/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Ayame/ })).not.toBeInTheDocument()
  })

  it('turns the scene into a group scene and says who arrived', async () => {
    renderRoute('/chat/5')
    await sceneAction('Invite character →')
    await userEvent.click(await screen.findByRole('button', { name: /Kaguya/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Invite →/ }))

    await waitFor(() => expect(api.callsTo('scenes:inviteCharacters')).toEqual([[5, [11]]]))
    expect(await screen.findByText('Kaguya joins the scene.')).toBeInTheDocument()
    // A second voice means the scene now needs to be told who answers.
    expect(await screen.findByRole('button', { name: 'Next: Ayame' })).toBeInTheDocument()
  })

  it('will not invite nobody', async () => {
    renderRoute('/chat/5')
    await sceneAction('Invite character →')
    expect(await screen.findByRole('button', { name: /^Invite →/ })).toBeDisabled()
  })

  it('says so when the whole world is already in the scene', async () => {
    seed({ characterIds: [10, 11] })
    renderRoute('/chat/5')
    await sceneAction('Invite character →')
    expect(
      await screen.findByText('Everyone in this world is already in the scene.')
    ).toBeInTheDocument()
  })
})

describe('an automatic pass at the end of a turn', () => {
  beforeEach(() => seed())

  it('holds the composer until the pass finishes, then delivers the turn', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'Hello.')
    await userEvent.keyboard('{Enter}')
    await chunk('She looks up.')
    await act(async () => api.status(api.lastRequestId, 'summarizing'))

    expect(await screen.findByText('summarizing')).toBeInTheDocument()
    expect(screen.getByText('the reply lands when this finishes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send →' })).not.toBeInTheDocument()

    await finish()
    expect(await screen.findByRole('button', { name: 'Send →' })).toBeEnabled()
  })

  it('says so when an automatic pass could not run', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'Hello.')
    await userEvent.keyboard('{Enter}')
    await chunk('She looks up.')
    await act(async () => api.done(api.lastRequestId, 'The automatic summary did not run: offline'))
    expect(
      await screen.findByText('The automatic summary did not run: offline')
    ).toBeInTheDocument()
  })
})

describe('a one-shot generation in flight', () => {
  beforeEach(() => {
    seed({ messages: [makeMessage({ id: 100, sceneId: 5 })] })
    api.store.personas = [
      {
        id: 1,
        name: 'Kyzer',
        description: 'A wandering scribe.',
        createdAt: '2026-08-22T00:00:00.000Z'
      }
    ]
    api.store.scenes[0]!.personaId = 1
  })

  it('takes the Impersonate button off the table until it settles', async () => {
    api.defer('chat:impersonate')
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Impersonate' }))

    expect(await screen.findByText('drafting your turn')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Impersonate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send →' })).toBeDisabled()
    // Moving an action behind the overlay does not let it through the guard.
    await userEvent.click(screen.getByRole('button', { name: 'Scene actions →' }))
    expect(await screen.findByRole('button', { name: 'Suggest memories →' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')

    await act(async () => api.release('chat:impersonate'))
    expect(await screen.findByRole('button', { name: 'Impersonate' })).toBeEnabled()
    expect(api.callsTo('chat:impersonate')).toHaveLength(1)
    expect(composer()).toHaveValue('I step closer.')
  })

  it('never stacks a second prompt from a burst of clicks in one frame', async () => {
    api.defer('chat:impersonate')
    renderRoute('/chat/5')
    const button = await screen.findByRole('button', { name: 'Impersonate' })
    // Fired without awaiting between them, so React cannot swap the button out
    // first: only the in-flight guard stands between this and five prompts.
    await act(async () => {
      for (let i = 0; i < 5; i++) fireEvent.click(button)
    })

    expect(api.callsTo('chat:impersonate')).toHaveLength(1)
    await act(async () => api.release('chat:impersonate'))
    expect(api.callsTo('chat:impersonate')).toHaveLength(1)
  })

  it('stops the generation from the composer', async () => {
    api.defer('chat:impersonate')
    renderRoute('/chat/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Impersonate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(api.callsTo('chat:cancelOneShot')).toContainEqual([5])
    await act(async () => api.release('chat:impersonate'))
  })

  it('says nothing when a stopped generation comes back cancelled', async () => {
    api.failNext('chat:impersonate', 'The request was stopped.', 'cancelled')
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'my own words')
    await userEvent.click(screen.getByRole('button', { name: 'Impersonate' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Impersonate' })).toBeEnabled())
    expect(screen.queryByText('The request was stopped.')).not.toBeInTheDocument()
    expect(composer()).toHaveValue('my own words')
  })

  it('blocks the scene tools while a reply is streaming', async () => {
    renderRoute('/chat/5')
    await userEvent.type(await screen.findByPlaceholderText('Say something'), 'hello')
    await userEvent.keyboard('{Enter}')
    await chunk('She looks up.')

    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Impersonate' })).toBeDisabled()
    await finish()
  })
})

describe('a cast member the Hub has stopped publishing', () => {
  it('says the scene keeps them', async () => {
    api = installFakeApi({
      worlds: [makeWorld({ id: 1 })],
      characters: [
        makeCharacter({ id: 10, worldId: 1, name: 'Ayame' }),
        makeCharacter({ id: 11, worldId: 1, name: 'Kaguya', retiredAt: '2026-08-01T00:00:00.000Z' })
      ],
      scenes: [makeScene({ id: 5, worldId: 1, characterIds: [10, 11] })],
      messages: []
    })
    renderRoute('/chat/5')
    expect(
      await screen.findByText(/Kaguya is no longer in the published canon/)
    ).toBeInTheDocument()
  })

  it('stays quiet when the whole cast is current', async () => {
    seed({ characterIds: [10, 11] })
    renderRoute('/chat/5')
    await screen.findByPlaceholderText('Say something')
    expect(screen.queryByText(/no longer in the published canon/)).not.toBeInTheDocument()
  })
})

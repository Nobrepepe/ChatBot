import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFakeApi, makeCharacter, makeWorld, type FakeApi } from './fakeApi'
import { renderRoute } from './renderRoute'

let api: FakeApi

beforeEach(() => {
  api = installFakeApi({
    worlds: [makeWorld({ id: 1 })],
    characters: [
      makeCharacter({
        id: 10,
        worldId: 1,
        name: 'Ayame',
        appearance: 'Kimono, cherry blossom.',
        personality: 'Watchful.'
      })
    ]
  })
})

/** Does `first` come before `second` in the document? */
function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/**
 * The screen paints its chrome before the character query resolves, so wait
 * on the headline — it only shows the name once the draft is populated.
 */
async function openEditor(name = 'Ayame', route = '/world/1/character/10') {
  const view = renderRoute(route)
  await screen.findByRole('heading', { name })
  return view
}

describe('character editor layout', () => {
  it('puts the art column before the fields, so reading order matches the screen', async () => {
    await openEditor()
    expect(precedes(screen.getByText('Portrait'), screen.getByText('Basics'))).toBe(true)
    expect(precedes(screen.getByText('Shelf image'), screen.getByText('Basics'))).toBe(true)
  })

  it('bleeds the backdrop portrait off the right edge', async () => {
    const { container } = await openEditor()
    const backdropArt = container.querySelector('.backdrop img') as HTMLElement
    expect(backdropArt).toBeTruthy()
    expect(backdropArt.style.right).not.toBe('')
    expect(backdropArt.style.left).toBe('')
  })

  it('scrims the backdrop so the fields beside it stay readable', async () => {
    const { container } = await openEditor()
    expect(container.querySelector('.backdrop .scrim-side')).toBeTruthy()
  })
})

describe('the profile dot path', () => {
  it('offers all eight sections and marks which are written', async () => {
    await openEditor()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(8)
    expect(within(tabs[0]!).getByText('written')).toBeInTheDocument() // Appearance
    expect(within(tabs[1]!).getByText('written')).toBeInTheDocument() // Personality
    expect(within(tabs[2]!).getByText('empty')).toBeInTheDocument() // Backstory
  })

  it('names the first empty section in the progress sentence', async () => {
    renderRoute('/world/1/character/10')
    expect(
      await screen.findByText(/2 of the eight profile sections are written — Backstory is still empty/)
    ).toBeInTheDocument()
  })

  it('switches the visible section when a dot is chosen', async () => {
    await openEditor()
    const tabs = screen.getAllByRole('tab')
    expect(screen.getByLabelText('Appearance')).toHaveValue('Kimono, cherry blossom.')
    await userEvent.click(tabs[4]!) // Voice
    expect(screen.queryByLabelText('Appearance')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Voice')).toBeInTheDocument()
  })

  it('celebrates a complete profile', async () => {
    Object.assign(api.store.characters[0]!, {
      backstory: 'b',
      behaviorRules: 'r',
      voiceStyle: 'v',
      relationshipToUser: 'rel',
      aiInstructions: 'ai'
    })
    api.store.sprites.push({
      id: 99,
      characterId: 10,
      name: 'Sad',
      callSign: 'sad',
      imagePath: 'x.png',
      sortOrder: 0
    })
    renderRoute('/world/1/character/10')
    expect(await screen.findByText(/All eight profile sections are written/)).toBeInTheDocument()
  })
})

describe('editing', () => {
  it('saves edited fields back through the character draft', async () => {
    await openEditor()
    await userEvent.type(screen.getByLabelText('Nicknames'), 'Aya')
    await userEvent.click(screen.getByRole('button', { name: /Save Ayame/ }))

    await waitFor(() => expect(api.callsTo('characters:save')).toHaveLength(1))
    const [draft] = api.callsTo('characters:save')[0] as [any]
    expect(draft).toMatchObject({ id: 10, worldId: 1, name: 'Ayame', nicknames: 'Aya' })
  })

  it('refuses to save a character with no name', async () => {
    api.store.characters[0]!.name = ''
    renderRoute('/world/1/character/10')
    await userEvent.click(await screen.findByRole('button', { name: /Save the character/ }))
    expect(await screen.findByText('A character needs a name.')).toBeInTheDocument()
    expect(api.callsTo('characters:save')).toHaveLength(0)
  })

  it('imports a portrait and persists it', async () => {
    api.store.nextImportPath = 'worlds/hv/new-portrait.png'
    await openEditor()
    await userEvent.click(screen.getByRole('button', { name: /Import a portrait/ }))
    await waitFor(() => expect(api.callsTo('characters:save')).toHaveLength(1))
    const [draft] = api.callsTo('characters:save')[0] as [any]
    expect(draft.portraitPath).toBe('worlds/hv/new-portrait.png')
  })

  it('leaves everything alone when the import is cancelled', async () => {
    api.store.nextImportPath = null
    await openEditor()
    await userEvent.click(screen.getByRole('button', { name: /Import a portrait/ }))
    await waitFor(() => expect(api.callsTo('assets:importImage')).toHaveLength(1))
    expect(api.callsTo('characters:save')).toHaveLength(0)
  })

  it('reaches the memories screen', async () => {
    const view = await openEditor()
    await userEvent.click(screen.getByRole('button', { name: /Memories/ }))
    await waitFor(() => expect(view.path()).toBe('/world/1/character/10/memories'))
  })
})

describe('a hub-managed character', () => {
  beforeEach(() => {
    api.store.characters[0]!.hubId = 'c-1'
  })

  it('is read-only and says where updates come from', async () => {
    await openEditor()
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Appearance')).toHaveAttribute('readonly')
    expect(
      screen.getByText(/comes from a World Hub publication and is read-only here/)
    ).toBeInTheDocument()
  })

  it('offers no save, import or delete', async () => {
    await openEditor()
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Import a portrait/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Delete$/ })).not.toBeInTheDocument()
  })
})

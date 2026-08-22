import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFakeApi, makeCharacter, makeWorld, type FakeApi } from './fakeApi'
import { artInside, renderRoute } from './renderRoute'

let api: FakeApi

beforeEach(() => {
  api = installFakeApi({
    worlds: [makeWorld({ id: 1, tone: 'Wistful' })],
    characters: [
      makeCharacter({ id: 10, worldId: 1, name: 'Ayame' }),
      makeCharacter({ id: 11, worldId: 1, name: 'Kaguya' })
    ],
    personas: [{ id: 20, name: 'Rui', description: 'A scribe.', createdAt: '' }]
  })
})

const castTile = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`${name}\\s*(in|not in) this scene`) })

describe('choosing a cast', () => {
  it('starts with nobody chosen and says so in words', async () => {
    renderRoute('/world/1/scene/new')
    expect(await screen.findByRole('button', { name: /Ayame/ })).toHaveTextContent('not in this scene')
    expect(screen.getByText('not ready — pick a character')).toBeInTheDocument()
  })

  it('ghosts the art of characters who are not in the scene', async () => {
    // Here dimming is meaningful: colour returning marks the selection.
    renderRoute('/world/1/scene/new')
    await screen.findByRole('button', { name: /Ayame/ })
    expect(artInside(castTile('Ayame'))!.className).toContain('art-ghost')

    await userEvent.click(castTile('Ayame'))
    expect(artInside(castTile('Ayame'))!.className).not.toContain('art-ghost')
    expect(castTile('Ayame')).toHaveTextContent('in this scene')
  })

  it('becomes ready once someone is cast, and can be undone', async () => {
    renderRoute('/world/1/scene/new')
    await userEvent.click(await screen.findByRole('button', { name: /Ayame/ }))
    expect(screen.getByText('ready')).toBeInTheDocument()

    await userEvent.click(castTile('Ayame'))
    expect(await screen.findByText('not ready — pick a character')).toBeInTheDocument()
  })

  it('will not begin a scene with an empty cast', async () => {
    renderRoute('/world/1/scene/new')
    const begin = await screen.findByRole('button', { name: /Begin the scene/ })
    expect(begin).toBeDisabled()
    await userEvent.click(begin)
    expect(api.callsTo('scenes:save')).toHaveLength(0)
  })
})

describe('starting the scene', () => {
  it('saves the setup and opens the conversation', async () => {
    const view = renderRoute('/world/1/scene/new')
    await userEvent.click(await screen.findByRole('button', { name: /Ayame/ }))
    await userEvent.click(castTile('Kaguya'))
    await userEvent.type(screen.getByLabelText('Premise'), 'A storm traps everyone inside.')
    await userEvent.click(screen.getByRole('button', { name: /Begin the scene/ }))

    await waitFor(() => expect(api.callsTo('scenes:save')).toHaveLength(1))
    const [draft] = api.callsTo('scenes:save')[0] as [any]
    expect(draft).toMatchObject({
      worldId: 1,
      premise: 'A storm traps everyone inside.',
      title: 'A storm traps everyone inside.',
      mode: 'roleplay',
      narratorEnabled: false,
      characterIds: [10, 11]
    })
    await waitFor(() => expect(view.path()).toMatch(/^\/chat\/\d+$/))
  })

  it('carries the mode, narrator and persona into the scene', async () => {
    renderRoute('/world/1/scene/new')
    await userEvent.click(await screen.findByRole('button', { name: /Ayame/ }))
    await userEvent.click(screen.getByRole('tab', { name: 'Interview' }))
    await userEvent.selectOptions(screen.getByLabelText('Narrator'), 'on')
    await userEvent.selectOptions(screen.getByLabelText('You are'), '20')
    await userEvent.click(screen.getByRole('button', { name: /Begin the scene/ }))

    await waitFor(() => expect(api.callsTo('scenes:save')).toHaveLength(1))
    const [draft] = api.callsTo('scenes:save')[0] as [any]
    expect(draft).toMatchObject({ mode: 'interview', narratorEnabled: true, personaId: 20 })
  })

  it('prefills the tone from the world', async () => {
    renderRoute('/world/1/scene/new')
    await waitFor(() => expect(screen.getByLabelText('Tone')).toHaveValue('Wistful'))
  })

  it('names an untitled scene rather than leaving it blank', async () => {
    renderRoute('/world/1/scene/new')
    await userEvent.click(await screen.findByRole('button', { name: /Ayame/ }))
    await userEvent.click(screen.getByRole('button', { name: /Begin the scene/ }))
    await waitFor(() => expect(api.callsTo('scenes:save')).toHaveLength(1))
    const [draft] = api.callsTo('scenes:save')[0] as [any]
    expect(draft.title).toBe('New scene')
  })
})

describe('saved setups', () => {
  it('refuses to save a template with no cast', async () => {
    renderRoute('/world/1/scene/new')
    await userEvent.click(await screen.findByRole('button', { name: /Save setup as template/ }))
    expect(await screen.findByText('Pick at least one character first.')).toBeInTheDocument()
    expect(api.callsTo('templates:save')).toHaveLength(0)
  })

  it('stores the current setup under a name', async () => {
    renderRoute('/world/1/scene/new')
    await userEvent.click(await screen.findByRole('button', { name: /Ayame/ }))
    await userEvent.click(screen.getByRole('button', { name: /Save setup as template/ }))
    await userEvent.clear(await screen.findByLabelText('Setup name'))
    await userEvent.type(screen.getByLabelText('Setup name'), 'Rooftop opener')
    await userEvent.click(screen.getByRole('button', { name: /Save the setup/ }))

    await waitFor(() => expect(api.callsTo('templates:save')).toHaveLength(1))
    const [draft] = api.callsTo('templates:save')[0] as [any]
    expect(draft).toMatchObject({ name: 'Rooftop opener', characterIds: [10] })
  })

  it('restores a saved setup, dropping characters that no longer exist', async () => {
    api.store.templates.push({
      id: 30,
      worldId: 1,
      name: 'Rooftop opener',
      premise: 'On the rooftop.',
      tone: 'Tense',
      timeOfDay: 'Night',
      relationshipStatus: 'Wary',
      mode: 'roleplay',
      narratorEnabled: true,
      locationId: null,
      personaId: null,
      characterIds: [10, 999]
    })
    renderRoute('/world/1/scene/new/30')
    await waitFor(() => expect(screen.getByLabelText('Premise')).toHaveValue('On the rooftop.'))
    expect(castTile('Ayame')).toHaveTextContent('in this scene')
    expect(castTile('Kaguya')).toHaveTextContent('not in this scene')
  })
})

describe('a world with nobody in it', () => {
  it('says so instead of showing an empty grid', async () => {
    api.store.characters = []
    renderRoute('/world/1/scene/new')
    expect(
      await screen.findByText('No characters in this world yet — make one first.')
    ).toBeInTheDocument()
  })
})

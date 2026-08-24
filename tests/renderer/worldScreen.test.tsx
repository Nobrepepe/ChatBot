import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFakeApi, makeScene, makeWorld, type FakeApi } from './fakeApi'
import { renderRoute } from './renderRoute'

let api: FakeApi

beforeEach(() => {
  api = installFakeApi({ worlds: [makeWorld({ id: 1, name: 'Hidden Village' })] })
})

describe('moving around a world', () => {
  it('titles the screen with the world and offers its five tabs', async () => {
    renderRoute('/world/1')
    expect(await screen.findByRole('heading', { name: 'Hidden Village' })).toBeInTheDocument()
    for (const tab of ['World', 'Characters', 'Sessions', 'Lorebook', 'Notes']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument()
    }
  })

  it('keeps the open tab in the URL so it survives a reload', async () => {
    const view = renderRoute('/world/1')
    await userEvent.click(await screen.findByRole('tab', { name: 'Lorebook' }))
    await waitFor(() => expect(view.path()).toBe('/world/1/lorebook'))
  })

  it('opens straight into the tab named by the route', async () => {
    renderRoute('/world/1/sessions')
    expect(await screen.findByRole('button', { name: /Start a new scene/ })).toBeInTheDocument()
  })

  it('greets an unmade world without pretending it exists', async () => {
    renderRoute('/world/new')
    expect(await screen.findByRole('heading', { name: 'A new world.' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Characters' })).not.toBeInTheDocument()
  })
})

describe('world details', () => {
  it('saves edits to the identity fields', async () => {
    renderRoute('/world/1')
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Hidden Village'))
    await userEvent.clear(screen.getByLabelText('Genre'))
    await userEvent.type(screen.getByLabelText('Genre'), 'Folk horror')
    await userEvent.click(screen.getByRole('button', { name: /Save the world/ }))

    await waitFor(() => expect(api.callsTo('worlds:save')).toHaveLength(1))
    const [draft] = api.callsTo('worlds:save')[0] as [any]
    expect(draft).toMatchObject({ id: 1, name: 'Hidden Village', genre: 'Folk horror' })
    expect(await screen.findByText('World saved.')).toBeInTheDocument()
  })

  it('refuses a nameless world', async () => {
    api.store.worlds[0]!.name = ''
    renderRoute('/world/1')
    await userEvent.click(await screen.findByRole('button', { name: /Save the world/ }))
    expect(await screen.findByText('A world needs a name.')).toBeInTheDocument()
    expect(api.callsTo('worlds:save')).toHaveLength(0)
  })

  it('spells out what a deletion takes with it', async () => {
    renderRoute('/world/1')
    await userEvent.click(await screen.findByRole('button', { name: /Delete Hidden Village/ }))
    expect(
      await screen.findByText('Its characters, scenes, chats, lore and memories will be removed.')
    ).toBeInTheDocument()
  })

  it('imports cover art and saves it in one step', async () => {
    api.store.nextImportPath = 'worlds/hv/cover.png'
    renderRoute('/world/1')
    await userEvent.click(await screen.findByRole('tab', { name: 'Art' }))
    await userEvent.click(screen.getAllByRole('button', { name: /Import an image/ })[0]!)
    await waitFor(() => expect(api.callsTo('worlds:save')).toHaveLength(1))
    const [draft] = api.callsTo('worlds:save')[0] as [any]
    expect(draft.coverImagePath).toBe('worlds/hv/cover.png')
  })

  it('is read-only when the world comes from the Hub', async () => {
    api.store.worlds[0]!.hubId = 'w-1'
    renderRoute('/world/1')
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveAttribute('readonly'))
    expect(screen.getByText(/comes from a World Hub publication and is read-only here/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save the world/ })).not.toBeInTheDocument()
  })
})

describe('the lorebook', () => {
  beforeEach(() => {
    api.store.lore.push(
      {
        id: 50,
        worldId: 1,
        title: 'The Accord',
        content: 'An old truce.',
        keywords: [],
        alwaysInclude: true,
        hubId: null,
        publicationId: null,
        createdAt: '',
        updatedAt: ''
      },
      {
        id: 51,
        worldId: 1,
        title: 'The Storm Bell',
        content: 'It rings before floods.',
        keywords: ['storm', 'bell'],
        alwaysInclude: false,
        hubId: null,
        publicationId: null,
        createdAt: '',
        updatedAt: ''
      }
    )
  })

  it('counts what is always included against what waits for keywords', async () => {
    renderRoute('/world/1/lorebook')
    expect(
      await screen.findByText(/entries; 1 always included and 1 waiting for keywords/)
    ).toBeInTheDocument()
  })

  it('says why each entry would reach a prompt', async () => {
    renderRoute('/world/1/lorebook')
    expect(await screen.findByText('Always included')).toBeInTheDocument()
    expect(screen.getByText('Triggered by storm, bell')).toBeInTheDocument()
  })

  it('writes a new entry with its trigger keywords', async () => {
    renderRoute('/world/1/lorebook')
    await userEvent.click(await screen.findByRole('button', { name: /New lore/ }))
    await userEvent.type(await screen.findByLabelText('Title'), 'The Ferry')
    await userEvent.type(screen.getByLabelText('Trigger keywords'), 'ferry, river ')
    await userEvent.click(screen.getByRole('button', { name: /Save the lore/ }))

    await waitFor(() => expect(api.callsTo('lore:save')).toHaveLength(1))
    const [draft] = api.callsTo('lore:save')[0] as [any]
    expect(draft).toMatchObject({ worldId: 1, title: 'The Ferry', keywords: ['ferry', 'river'] })
  })

  it('lets hub lore keep its text while its keywords stay tunable', async () => {
    api.store.lore[1]!.hubId = 'doc-1'
    renderRoute('/world/1/lorebook')
    await userEvent.click(await screen.findByRole('button', { name: 'Tune keywords' }))
    expect(await screen.findByLabelText('Title')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Trigger keywords')).not.toHaveAttribute('readonly')
    expect(
      screen.getByText('Hub lore keeps its text; only the trigger keywords are yours to tune.')
    ).toBeInTheDocument()
  })

  it('explains the point of the lorebook when it is empty', async () => {
    api.store.lore = []
    renderRoute('/world/1/lorebook')
    expect(
      await screen.findByText(/Lore entries reach the model only when their keywords appear/)
    ).toBeInTheDocument()
  })
})

describe('the sessions tab', () => {
  it('says so plainly when nothing has been played', async () => {
    renderRoute('/world/1/sessions')
    expect(await screen.findByText('Nothing has been played here yet.')).toBeInTheDocument()
  })

  it('leads with starting a scene', async () => {
    const view = renderRoute('/world/1/sessions')
    await userEvent.click(await screen.findByRole('button', { name: /Start a new scene/ }))
    await waitFor(() => expect(view.path()).toBe('/world/1/scene/new'))
  })

  it('lists scenes and opens one', async () => {
    api.store.scenes.push(makeScene({ id: 5, worldId: 1, title: 'The rooftop' }))
    const view = renderRoute('/world/1/sessions')
    await userEvent.click(await screen.findByRole('button', { name: /Open scene/ }))
    await waitFor(() => expect(view.path()).toBe('/chat/5'))
  })

  it('promises memories survive deleting a scene', async () => {
    api.store.scenes.push(makeScene({ id: 5, worldId: 1, title: 'The rooftop' }))
    renderRoute('/world/1/sessions')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(
      await screen.findByText('Its transcript will be removed. Character memories remain.')
    ).toBeInTheDocument()
  })

  it('shows where each scene stands, from its summary', async () => {
    api.store.scenes.push(
      makeScene({
        id: 6,
        worldId: 1,
        title: 'The pier',
        summary: '- They argued about the boat.\n- Nothing was settled.'
      })
    )
    renderRoute('/world/1/sessions')
    expect(
      await screen.findByText('They argued about the boat. · Nothing was settled.')
    ).toBeInTheDocument()
  })

  it('offers saved setups as a way in', async () => {
    api.store.templates.push({
      id: 30,
      worldId: 1,
      name: 'Rooftop opener',
      title: '',
      previouslyOn: '',
      mode: 'roleplay',
      narratorEnabled: false,
      locationId: null,
      personaId: null,
      characterIds: []
    })
    const view = renderRoute('/world/1/sessions')
    expect(await screen.findByText('Saved setups')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Use setup/ }))
    await waitFor(() => expect(view.path()).toBe('/world/1/scene/new/30'))
  })
})

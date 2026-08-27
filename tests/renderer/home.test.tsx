import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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

beforeEach(() => {
  api = installFakeApi()
})

describe('the home screen with nothing made yet', () => {
  it('invites the writer to start rather than showing an empty list', async () => {
    renderRoute('/')
    expect(
      await screen.findByText(/Nothing started yet — make a world and it will wait for you here/)
    ).toBeInTheDocument()
    expect(
      await screen.findByText('No worlds yet. A world holds its characters, scenes and lore.')
    ).toBeInTheDocument()
  })

  it('routes to a new world', async () => {
    const view = renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: /Make a world/ }))
    await waitFor(() => expect(view.path()).toBe('/world/new'))
  })
})

describe('the home screen with a world but no scene', () => {
  beforeEach(() => {
    api.store.worlds.push(makeWorld({ id: 1, name: 'Hidden Village' }))
  })

  it('says the world is waiting', async () => {
    renderRoute('/')
    expect(await screen.findByText('Hidden Village is waiting for its first scene.')).toBeInTheDocument()
  })

  it('lists the world and opens it', async () => {
    const view = renderRoute('/')
    await userEvent.click(await screen.findByRole('button', { name: /Hidden Village/ }))
    await waitFor(() => expect(view.path()).toBe('/world/1'))
  })
})

describe('a world the Hub has stopped publishing', () => {
  beforeEach(() => {
    api.store.worlds.push(
      makeWorld({ id: 1, name: 'Hidden Village', retiredAt: '2026-08-01T00:00:00.000Z' })
    )
    api.store.scenes.push(makeScene({ id: 5, worldId: 1, title: 'The rooftop' }))
  })

  it('still lists it, and says why it is there', async () => {
    const view = renderRoute('/')
    const row = await screen.findByRole('button', { name: /Hidden Village/ })
    expect(row).toHaveTextContent('No longer published — its scenes still open')
    await userEvent.click(row)
    await waitFor(() => expect(view.path()).toBe('/world/1'))
  })

  it('offers the way back into the scene it holds', async () => {
    renderRoute('/')
    expect(await screen.findByText('Hidden Village is still mid-scene.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Return to The rooftop/ })).toBeInTheDocument()
  })
})

describe('the home screen mid-scene', () => {
  beforeEach(() => {
    api.store.worlds.push(makeWorld({ id: 1, name: 'Hidden Village' }))
    api.store.scenes.push(makeScene({ id: 5, worldId: 1, title: 'The rooftop' }))
  })

  it('names the world and offers the way back in', async () => {
    const view = renderRoute('/')
    expect(await screen.findByText('Hidden Village is still mid-scene.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Return to The rooftop/ }))
    await waitFor(() => expect(view.path()).toBe('/chat/5'))
  })

  it('reports that the whole conversation still fits in the history window', async () => {
    api.store.messages.push(makeMessage({ sceneId: 5 }), makeMessage({ sceneId: 5 }))
    renderRoute('/')
    expect(await screen.findByText('The history window carries all 2 messages.')).toBeInTheDocument()
    expect(screen.getByText('messages in this scene')).toBeInTheDocument()
  })

  it('warns in prose when messages have fallen outside the window', async () => {
    api.store.settings.historyLimit = '2'
    for (let i = 0; i < 5; i++) api.store.messages.push(makeMessage({ sceneId: 5 }))
    renderRoute('/')
    expect(
      await screen.findByText(/The history window carries the last 2\. 3 now fall outside it/)
    ).toBeInTheDocument()
  })

  it('says whether the scene has been summarized', async () => {
    renderRoute('/')
    expect(await screen.findByText(/nothing summarized yet/)).toBeInTheDocument()
  })

  it('shows where the scene stands, not just that it was summarized', async () => {
    api.store.scenes[0]!.summary = '- She came looking for you.\n- Nothing was settled.'
    renderRoute('/')
    expect(await screen.findByText('Where it stands')).toBeInTheDocument()
    expect(
      screen.getByText('She came looking for you. · Nothing was settled.')
    ).toBeInTheDocument()
  })
})

describe('the character the scene is waiting on', () => {
  beforeEach(() => {
    api.store.worlds.push(makeWorld({ id: 1, name: 'Hidden Village' }))
    api.store.characters.push(
      makeCharacter({ id: 10, worldId: 1, name: 'Ayame', portraitPath: 'worlds/hv/ayame.png' }),
      makeCharacter({ id: 11, worldId: 1, name: 'Kaguya', portraitPath: 'worlds/hv/kaguya.png' })
    )
    api.store.scenes.push(
      makeScene({ id: 5, worldId: 1, title: 'The rooftop', characterIds: [10, 11] })
    )
  })

  it('is named in the line under the headline, and is whoever spoke last', async () => {
    api.store.messages.push(
      makeMessage({ sceneId: 5, role: 'character', characterId: 10, content: 'Hello.' }),
      makeMessage({ sceneId: 5, role: 'character', characterId: 11, content: 'And me.' })
    )
    renderRoute('/')
    expect(await screen.findByText(/with Kaguya\./)).toBeInTheDocument()
  })

  it('falls back to the first of the cast before anyone has spoken', async () => {
    renderRoute('/')
    expect(await screen.findByText(/with Ayame\./)).toBeInTheDocument()
  })

  it('is not drawn: the art on this screen is the world, not the cast', async () => {
    renderRoute('/')
    await screen.findByText(/with Ayame\./)
    const backdropArt = [...document.querySelectorAll<HTMLImageElement>('.backdrop img')]
    expect(backdropArt.some((img) => img.src.includes('ayame'))).toBe(false)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFakeApi, makeCharacter, makeWorld, type FakeApi } from './fakeApi'
import { artInside, renderRoute } from './renderRoute'

let api: FakeApi

beforeEach(() => {
  const world = makeWorld({ id: 1 })
  api = installFakeApi({
    worlds: [world],
    characters: [
      makeCharacter({ id: 10, worldId: 1, name: 'Ayame' }),
      makeCharacter({ id: 11, worldId: 1, name: 'Kaguya', role: 'Envoy', summary: 'Written.' })
    ]
  })
})

const tile = (name: string): HTMLElement => screen.getByTitle(`Open ${name}`)

describe('browsing a world’s characters', () => {
  it('lists every character in the world', async () => {
    renderRoute('/world/1/characters')
    expect(await screen.findByTitle('Open Ayame')).toBeInTheDocument()
    expect(screen.getByTitle('Open Kaguya')).toBeInTheDocument()
  })

  it('keeps tile art in full colour even when the profile is unwritten', async () => {
    // Dimming reads as "not selected", which is meaningless in a grid whose
    // only job is to open a profile. The empty state is carried by the caption.
    renderRoute('/world/1/characters')
    const unwritten = await screen.findByTitle('Open Ayame')
    expect(artInside(unwritten)!.className).not.toContain('art-ghost')
    expect(artInside(tile('Kaguya'))!.className).not.toContain('art-ghost')
  })

  it('states an unwritten profile in words instead', async () => {
    renderRoute('/world/1/characters')
    await screen.findByTitle('Open Ayame')
    expect(tile('Ayame')).toHaveTextContent('Profile empty')
    expect(tile('Kaguya')).toHaveTextContent('Envoy')
    expect(tile('Kaguya')).not.toHaveTextContent('Profile empty')
  })

  it('opens the character on click', async () => {
    const view = renderRoute('/world/1/characters')
    await screen.findByTitle('Open Ayame')
    await userEvent.click(tile('Ayame'))
    await waitFor(() => expect(view.path()).toBe('/world/1/character/10'))
  })

  it('offers a way to add someone', async () => {
    const view = renderRoute('/world/1/characters')
    await userEvent.click(await screen.findByRole('button', { name: /New character/ }))
    await waitFor(() => expect(view.path()).toBe('/world/1/character/new'))
  })

  it('hides authoring actions for a hub-managed world', async () => {
    api.store.worlds[0]!.hubId = 'w-1'
    renderRoute('/world/1/characters')
    await screen.findByTitle('Open Ayame')
    expect(screen.queryByRole('button', { name: /New character/ })).not.toBeInTheDocument()
  })

  it('falls back to a hatch when a character has no art', async () => {
    api.store.characters[0]!.tileImagePath = ''
    api.store.characters[0]!.portraitPath = ''
    renderRoute('/world/1/characters')
    await screen.findByTitle('Open Ayame')
    expect(artInside(tile('Ayame'))).toBeNull()
    expect(tile('Ayame')).toHaveTextContent('NO PORTRAIT')
  })
})

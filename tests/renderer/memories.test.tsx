import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  installFakeApi,
  makeCharacter,
  makeMemory,
  makeProposal,
  makeWorld,
  type FakeApi
} from './fakeApi'
import { renderRoute } from './renderRoute'

let api: FakeApi

beforeEach(() => {
  api = installFakeApi({
    worlds: [makeWorld({ id: 1 })],
    characters: [makeCharacter({ id: 10, worldId: 1, name: 'Ayame' })],
    memories: [
      makeMemory({ id: 30, characterId: 10, type: 'canon', content: 'Ayame cannot swim.' }),
      makeMemory({ id: 31, characterId: 10, type: 'relationship', content: 'She trusts you now.' })
    ]
  })
})

const route = '/world/1/character/10/memories'

describe('what a character carries', () => {
  it('counts only what is actually injected into prompts', async () => {
    renderRoute(route)
    expect(await screen.findByText('Ayame carries 2 memories into every scene.')).toBeInTheDocument()
    expect(screen.getByText('injected into every prompt')).toBeInTheDocument()
  })

  it('separates permanent canon from how they feel about you', async () => {
    renderRoute(route)
    expect(await screen.findByText('Canon · permanently true')).toBeInTheDocument()
    expect(screen.getByText('Ayame cannot swim.')).toBeInTheDocument()
    expect(screen.getByText('Relationship · how they feel about you')).toBeInTheDocument()
    expect(screen.getByText('She trusts you now.')).toBeInTheDocument()
  })

  it('says plainly when there is nothing yet', async () => {
    api.store.memories = []
    renderRoute(route)
    expect(await screen.findByText('Ayame carries nothing yet into every scene.')).toBeInTheDocument()
  })

  it('adds a canon memory', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: /Add canon/ }))
    await userEvent.type(await screen.findByLabelText('Memory'), 'She keeps a knife in her sleeve.')
    await userEvent.click(screen.getByRole('button', { name: /Keep it/ }))

    await waitFor(() => expect(api.callsTo('memories:save')).toHaveLength(1))
    const [draft] = api.callsTo('memories:save')[0] as [any]
    expect(draft).toMatchObject({
      characterId: 10,
      type: 'canon',
      content: 'She keeps a knife in her sleeve.',
      lifecycleStatus: 'canonical'
    })
  })

  it('will not keep an empty memory', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: /Add canon/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Keep it/ }))
    expect(await screen.findByText('A memory needs something true to carry.')).toBeInTheDocument()
    expect(api.callsTo('memories:save')).toHaveLength(0)
  })
})

describe('the review queue', () => {
  beforeEach(() => {
    api.store.proposals.push(
      makeProposal({
        id: 40,
        characterId: 10,
        characterName: 'Ayame',
        actionType: 'create',
        proposedContent: 'Ayame admitted she was afraid.',
        memoryType: 'canon'
      })
    )
  })

  it('marks waiting proposals as blocking, in colour and in words', async () => {
    renderRoute(route)
    expect(await screen.findByText('blocking review')).toBeInTheDocument()
    expect(screen.getByText('Ayame admitted she was afraid.')).toBeInTheDocument()
  })

  it('keeps proposals out of the injected count until they are approved', async () => {
    renderRoute(route)
    expect(await screen.findByText('Ayame carries 2 memories into every scene.')).toBeInTheDocument()
  })

  it('approves a proposal into canon', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: /Keep it/ }))
    await waitFor(() => expect(api.callsTo('memories:approveSuggestion')).toHaveLength(1))
    expect(api.callsTo('memories:approveSuggestion')[0]).toEqual([
      40,
      { content: 'Ayame admitted she was afraid.', type: 'canon' }
    ])
  })

  it('carries the user’s edit into the approval', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit first' }))
    const field = screen.getByDisplayValue('Ayame admitted she was afraid.')
    await userEvent.clear(field)
    await userEvent.type(field, 'Ayame said it out loud.')
    await userEvent.click(screen.getByRole('button', { name: /Keep it/ }))
    await waitFor(() => expect(api.callsTo('memories:approveSuggestion')).toHaveLength(1))
    const [, edited] = api.callsTo('memories:approveSuggestion')[0] as [number, any]
    expect(edited.content).toBe('Ayame said it out loud.')
  })

  it('rejects a proposal outright', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(api.callsTo('memories:rejectSuggestion')).toContainEqual([40]))
  })

  it('shows a rewrite against the memory it would replace', async () => {
    api.store.proposals = [
      makeProposal({
        id: 41,
        characterId: 10,
        characterName: 'Ayame',
        actionType: 'replace',
        targetMemoryId: 31,
        currentContent: 'She trusts you now.',
        proposedContent: 'She would follow you anywhere.',
        memoryType: 'relationship',
        lifecycleStatus: 'canonical'
      })
    ]
    renderRoute(route)
    expect(await screen.findByText('Currently')).toBeInTheDocument()
    expect(screen.getByText('Would become')).toBeInTheDocument()
    expect(screen.getByText('She would follow you anywhere.')).toBeInTheDocument()
  })

  it('offers a forget as a removal, not an edit', async () => {
    api.store.proposals = [
      makeProposal({
        id: 42,
        characterId: 10,
        characterName: 'Ayame',
        actionType: 'forget',
        targetMemoryId: 30,
        currentContent: 'Ayame cannot swim.',
        proposedContent: '',
        payload: { reason: 'She learned this spring.' }
      })
    ]
    renderRoute(route)
    expect(await screen.findByText(/She learned this spring./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Forget it/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit first' })).not.toBeInTheDocument()
  })

  it('says when nothing is waiting', async () => {
    api.store.proposals = []
    renderRoute(route)
    expect(await screen.findByText('nothing waiting')).toBeInTheDocument()
    expect(screen.queryByText('blocking review')).not.toBeInTheDocument()
  })
})

describe('session memories', () => {
  it('are tucked behind disclosure and labelled as never sent', async () => {
    api.store.memories.push(
      makeMemory({ id: 33, characterId: 10, type: 'session', content: 'A scene summary.' })
    )
    renderRoute(route)
    const toggle = await screen.findByRole('button', {
      name: /Session memories, never sent to the model/
    })
    expect(screen.queryByText('A scene summary.')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(await screen.findByText('A scene summary.')).toBeInTheDocument()
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFakeApi, type FakeApi } from './fakeApi'
import { renderRoute } from './renderRoute'

let api: FakeApi

beforeEach(() => {
  api = installFakeApi({
    personas: [{ id: 20, name: 'Rui', description: 'A traveling scribe.', createdAt: '' }]
  })
})

/** Personas is the simplest screen that drives the overlay stack. */
describe('overlays', () => {
  it('opens over the screen and reports its title', async () => {
    renderRoute('/personas')
    await userEvent.click(await screen.findByRole('button', { name: /New persona/ }))
    expect(await screen.findByRole('dialog', { name: 'Who are you in the scene?' })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    renderRoute('/personas')
    await userEvent.click(await screen.findByRole('button', { name: /New persona/ }))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes on the Close action', async () => {
    renderRoute('/personas')
    await userEvent.click(await screen.findByRole('button', { name: /New persona/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('stacks, and Escape dismisses only the topmost', async () => {
    renderRoute('/personas')
    // Editing a persona, then confirming its deletion, puts two on the stack.
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog', { name: 'Who are you in the scene?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(screen.getByRole('dialog', { name: 'Who are you in the scene?' })).toBeInTheDocument()
  })
})

describe('personas', () => {
  it('pluralises the headline from what exists', async () => {
    renderRoute('/personas')
    expect(await screen.findByText('One way to enter a scene.')).toBeInTheDocument()

    api.store.personas.push({ id: 21, name: 'Kai', description: '', createdAt: '' })
    const second = renderRoute('/personas')
    expect(await second.findByText('2 ways to enter a scene.')).toBeInTheDocument()
  })

  it('invites a first persona when there are none', async () => {
    api.store.personas = []
    renderRoute('/personas')
    expect(
      await screen.findByText('You can enter as yourself, or name someone new.')
    ).toBeInTheDocument()
  })

  it('saves a new persona', async () => {
    renderRoute('/personas')
    await userEvent.click(await screen.findByRole('button', { name: /New persona/ }))
    await userEvent.type(await screen.findByLabelText('Persona name'), 'Kai')
    await userEvent.type(screen.getByLabelText('Description'), 'A wandering cartographer.')
    await userEvent.click(screen.getByRole('button', { name: /Save the persona/ }))

    await waitFor(() => expect(api.callsTo('personas:save')).toHaveLength(1))
    const [draft] = api.callsTo('personas:save')[0] as [any]
    expect(draft).toMatchObject({ name: 'Kai', description: 'A wandering cartographer.' })
  })

  it('refuses a nameless persona', async () => {
    renderRoute('/personas')
    await userEvent.click(await screen.findByRole('button', { name: /New persona/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Save the persona/ }))
    expect(await screen.findByText('A persona needs a name.')).toBeInTheDocument()
    expect(api.callsTo('personas:save')).toHaveLength(0)
  })

  it('promises that existing conversations survive a deletion', async () => {
    renderRoute('/personas')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(
      await screen.findByText(/Their conversations remain intact/)
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Delete Rui/ }))
    await waitFor(() => expect(api.callsTo('personas:delete')).toContainEqual([20]))
  })
})

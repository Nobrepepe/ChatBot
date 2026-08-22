import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFakeApi, type FakeApi } from './fakeApi'
import { renderRoute } from './renderRoute'

let api: FakeApi

beforeEach(() => {
  api = installFakeApi()
  document.documentElement.removeAttribute('data-reduce-motion')
  document.documentElement.style.removeProperty('--text-scale')
})

describe('the endpoint section', () => {
  it('describes the connection in prose before anything is tested', async () => {
    renderRoute('/settings')
    expect(await screen.findByText(/Nothing tested yet at http:\/\/localhost:11434\/v1/)).toBeInTheDocument()
    expect(screen.getByText(/You are talking to no model, streaming, at temperature 0.8/)).toBeInTheDocument()
    expect(screen.getByText('not tested')).toBeInTheDocument()
  })

  it('reports latency and offers the discovered models', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('button', { name: /Test the connection/ }))
    expect(await screen.findByText('The endpoint answered in 12 ms.')).toBeInTheDocument()
    expect(screen.getByText('live')).toBeInTheDocument()
    expect(screen.getByLabelText('Models found')).toBeInTheDocument()
  })

  it('picks the first model when none was chosen, and saves it', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('button', { name: /Test the connection/ }))
    await waitFor(() => expect(api.callsTo('settings:save').length).toBeGreaterThan(0))
    const saved = api.callsTo('settings:save').at(-1)![0] as any
    expect(saved.model).toBe('mock-model-7b')
  })

  it('surfaces an unreachable endpoint without wiping the form', async () => {
    api.failNext('provider:test', 'Could not connect to http://localhost:11434/v1.')
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('button', { name: /Test the connection/ }))
    expect(await screen.findByText(/Could not connect to/)).toBeInTheDocument()
    expect(screen.getByLabelText('Base URL')).toHaveValue('http://localhost:11434/v1')
  })

  it('keeps the api key masked', async () => {
    renderRoute('/settings')
    expect(await screen.findByLabelText('API key')).toHaveAttribute('type', 'password')
  })
})

describe('generation settings', () => {
  it('refuses to save a non-numeric sampling value', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'Generation' }))
    const temperature = await screen.findByLabelText('Temperature')
    await userEvent.clear(temperature)
    await userEvent.type(temperature, 'warm')
    await userEvent.click(screen.getByRole('button', { name: /Save settings/ }))

    expect(await screen.findByText('Temperature needs a number.')).toBeInTheDocument()
    expect(api.callsTo('settings:save')).toHaveLength(0)
  })

  it('saves valid values and says when they take effect', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'Generation' }))
    const historyLimit = await screen.findByLabelText('History window')
    await userEvent.clear(historyLimit)
    await userEvent.type(historyLimit, '50')
    await userEvent.click(screen.getByRole('button', { name: /Save settings/ }))

    await waitFor(() => expect(api.callsTo('settings:save')).toHaveLength(1))
    const [values] = api.callsTo('settings:save')[0] as [any]
    expect(values.historyLimit).toBe('50')
    expect(
      await screen.findByText('Settings saved. Nothing changes the model until the next request.')
    ).toBeInTheDocument()
  })
})

describe('appearance settings', () => {
  it('applies reduced motion to the document as soon as it is chosen', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'Appearance' }))
    await userEvent.click(await screen.findByRole('tab', { name: 'Reduced' }))
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true)
  })

  it('applies the text scale immediately and clamps it', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'Appearance' }))
    await userEvent.click(await screen.findByRole('tab', { name: 'Large' }))
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.4')
  })

  it('keeps interface text stable while headlines scale', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'Appearance' }))
    expect(
      await screen.findByText('Headlines scale and wrap; interface text remains stable.')
    ).toBeInTheDocument()
  })
})

describe('the World Hub section', () => {
  it('explains legacy mode when no publication is active', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'World Hub' }))
    expect(await screen.findByText(/Legacy mode — worlds and characters are authored in this app/)).toBeInTheDocument()
    expect(screen.getByText('Linked folder: No production folder linked.')).toBeInTheDocument()
  })

  it('names the active publication in hub mode', async () => {
    api.store.hub = {
      hubMode: true,
      publicationId: '863eb475-b81b-45db-90e4-67afa5d131c4',
      receipt: { productionName: 'ChatBot', productionRevision: 40, importedAt: '2026-08-22T00:00:00Z' },
      previousPublicationId: null,
      linkedFolder: ''
    }
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'World Hub' }))
    expect(await screen.findByText(/Hub mode — “ChatBot” revision 40/)).toBeInTheDocument()
  })

  it('hides rollback when there is nothing to roll back to', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'World Hub' }))
    await screen.findByText(/Legacy mode/)
    expect(screen.queryByRole('button', { name: /Roll back/ })).not.toBeInTheDocument()
  })

  it('offers rollback once a previous publication exists', async () => {
    api.store.hub = { ...api.store.hub, hubMode: true, previousPublicationId: 'pub-1' }
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'World Hub' }))
    await userEvent.click(await screen.findByRole('button', { name: /Roll back/ }))
    await waitFor(() => expect(api.callsTo('hub:rollback')).toHaveLength(1))
    expect(
      await screen.findByText('Rolled back to the previous publication.')
    ).toBeInTheDocument()
  })

  it('offers the update check only once a folder is linked', async () => {
    api.store.hub = { ...api.store.hub, linkedFolder: '/home/shiro/hub/chatbot' }
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'World Hub' }))
    expect(await screen.findByRole('button', { name: /Check for update/ })).toBeInTheDocument()
    expect(screen.getByText('Linked folder: /home/shiro/hub/chatbot')).toBeInTheDocument()
  })

  it('promises the publication keeps working offline', async () => {
    renderRoute('/settings')
    await userEvent.click(await screen.findByRole('tab', { name: 'World Hub' }))
    expect(
      await screen.findByText(/copied into this app's data, so everything keeps working when the Hub library is unavailable/)
    ).toBeInTheDocument()
  })
})

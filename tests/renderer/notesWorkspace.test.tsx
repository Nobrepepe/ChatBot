import { describe, it, expect, beforeEach } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installFakeApi, makeNote, makeWorld, type FakeApi } from './fakeApi'
import { renderRoute } from './renderRoute'

let api: FakeApi

beforeEach(() => {
  api = installFakeApi({
    worlds: [makeWorld({ id: 1, name: 'Hidden Village' })],
    notes: [
      makeNote({ id: 40, worldId: 1, title: 'The Harbor', category: 'Setting' }),
      makeNote({
        id: 41,
        worldId: 1,
        title: 'Ayame',
        category: 'Characters',
        content: 'Keeps a knife in her sleeve.'
      })
    ]
  })
})

const route = '/world/1/notes'

describe('the private notes workspace', () => {
  it('promises the notes never reach a scene prompt', async () => {
    renderRoute(route)
    expect(await screen.findByText('Hidden Village stays private here.')).toBeInTheDocument()
    expect(screen.getByText(/Nothing here is sent with scene prompts/)).toBeInTheDocument()
  })

  it('groups notes under their categories with counts', async () => {
    renderRoute(route)
    expect(await screen.findByRole('button', { name: /Characters · 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Setting · 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Plot · 0/ })).toBeInTheDocument()
    expect(screen.getByTitle('Open note The Harbor')).toBeInTheDocument()
  })

  it('collapses a category', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: /Setting · 1/ }))
    expect(screen.queryByTitle('Open note The Harbor')).not.toBeInTheDocument()
  })

  it('searches across titles and content', async () => {
    renderRoute(route)
    await userEvent.type(await screen.findByLabelText('Search notes'), 'knife')
    await waitFor(() => expect(screen.queryByTitle('Open note The Harbor')).not.toBeInTheDocument())
    expect(screen.getByTitle('Open note Ayame')).toBeInTheDocument()
  })

  it('says when a search finds nothing', async () => {
    renderRoute(route)
    await userEvent.type(await screen.findByLabelText('Search notes'), 'zzzz')
    expect(await screen.findByText('No notes match this search.')).toBeInTheDocument()
  })

  it('filters to pinned notes', async () => {
    api.store.notes[0]!.isPinned = true
    renderRoute(route)
    await userEvent.click(await screen.findByRole('tab', { name: 'Pinned' }))
    expect(screen.getByTitle('Open note The Harbor')).toBeInTheDocument()
    expect(screen.queryByTitle('Open note Ayame')).not.toBeInTheDocument()
  })
})

describe('editing a note', () => {
  it('opens it in the editor and saves changes', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByTitle('Open note The Harbor'))
    const content = await screen.findByLabelText('Note')
    await userEvent.clear(content)
    await userEvent.type(content, 'Tides govern everything.')
    await userEvent.click(screen.getByRole('button', { name: /Save note/ }))

    await waitFor(() => expect(api.callsTo('notes:save')).toHaveLength(1))
    const [draft] = api.callsTo('notes:save')[0] as [any]
    expect(draft).toMatchObject({ id: 40, content: 'Tides govern everything.' })
  })

  it('flags unsaved work and says the assistant still sees the old version', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByTitle('Open note The Harbor'))
    await userEvent.type(await screen.findByLabelText('Note'), '!')
    expect(
      await screen.findByText('Unsaved — the assistant still sees the saved version')
    ).toBeInTheDocument()
  })

  it('keeps a draft when switching between notes', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByTitle('Open note The Harbor'))
    await userEvent.type(await screen.findByLabelText('Note'), ' AND MORE')
    await userEvent.click(screen.getByTitle('Open note Ayame'))
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Ayame'))

    await userEvent.click(screen.getByTitle('Open note The Harbor'))
    await waitFor(() =>
      expect(screen.getByLabelText('Note')).toHaveValue(
        'Tides govern the festival calendar. AND MORE'
      )
    )
  })

  it('duplicates a note', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByTitle('Open note The Harbor'))
    await userEvent.click(await screen.findByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(api.callsTo('notes:duplicate')).toContainEqual([40]))
  })

  it('warns that a deleted note cannot come back', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByTitle('Open note The Harbor'))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Its content cannot be recovered.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Delete the note/ }))
    await waitFor(() => expect(api.callsTo('notes:delete')).toContainEqual([40]))
  })

  it('creates a note from the browser', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: /New note →/ }))
    await userEvent.type(await screen.findByLabelText('Title'), 'The Bell')
    await userEvent.click(screen.getByRole('button', { name: /Create note/ }))
    await waitFor(() => expect(api.callsTo('notes:save')).toHaveLength(1))
    const [draft] = api.callsTo('notes:save')[0] as [any]
    expect(draft).toMatchObject({ worldId: 1, title: 'The Bell' })
  })
})

describe('the note switcher', () => {
  it('opens on Ctrl+K and jumps to a note', async () => {
    renderRoute(route)
    await screen.findByTitle('Open note The Harbor')
    await userEvent.keyboard('{Control>}k{/Control}')
    const dialog = await screen.findByRole('dialog', {
      name: 'Find a note without leaving the conversation.'
    })
    await userEvent.click(within(dialog).getByRole('button', { name: /Ayame/ }))
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Ayame'))
  })
})

describe('what the assistant will receive', () => {
  it('counts the notes going into the next message', async () => {
    api.store.notes[0]!.contextMode = 'always'
    renderRoute(route)
    expect(await screen.findByText('1 notes in context')).toBeInTheDocument()
  })

  it('says when nothing is in context', async () => {
    renderRoute(route)
    expect(await screen.findByText('No notes in context')).toBeInTheDocument()
  })

  it('lists each note with why it was chosen', async () => {
    api.store.notes[0]!.contextMode = 'always'
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: 'Review context' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'What the assistant will receive next.'
    })
    expect(within(dialog).getByText('The Harbor')).toBeInTheDocument()
    expect(within(dialog).getByText('always included')).toBeInTheDocument()
  })
})

describe('the assistant conversation', () => {
  it('sends a question and streams the reply', async () => {
    renderRoute(route)
    await userEvent.type(
      await screen.findByLabelText('Ask the writing assistant'),
      'Help me flesh out the harbor.'
    )
    await userEvent.click(screen.getByRole('button', { name: /Ask/ }))

    await waitFor(() => expect(api.callsTo('chat:start')).toHaveLength(1))
    const [params] = api.callsTo('chat:start')[0] as [any]
    expect(params).toMatchObject({
      kind: 'notesChat',
      worldId: 1,
      userMessage: 'Help me flesh out the harbor.'
    })

    await act(async () => {
      api.chunk(api.lastRequestId, 'The harbor could anchor your Setting notes.')
    })
    expect(screen.getByText(/The harbor could anchor your Setting notes/)).toBeInTheDocument()
  })

  it('warns that clearing keeps canonical notes but drops proposals', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: /Clear conversation/ }))
    expect(
      await screen.findByText(/Canonical notes remain\. The transcript and unapproved workspace proposals will be removed\./)
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Clear the conversation/ }))
    await waitFor(() => expect(api.callsTo('notesChat:clear')).toContainEqual([1]))
  })
})

describe('note proposals', () => {
  beforeEach(() => {
    api.store.noteChat.push({
      id: 60,
      worldId: 1,
      role: 'assistant',
      content: 'The harbor could anchor your Setting notes.',
      createdAt: ''
    })
    api.store.notes.push(
      makeNote({ id: 42, worldId: 1, title: 'The Piers', content: 'Draft.', lifecycleStatus: 'proposed' })
    )
    api.store.suggestions.push({
      id: 70,
      messageId: 60,
      ordinal: 0,
      actionType: 'create',
      targetNoteId: 42,
      payload: { type: 'create', title: 'The Piers', content: 'Smugglers use the third pier.' },
      status: 'pending'
    })
  })

  it('shows what the assistant proposed, unapproved', async () => {
    renderRoute(route)
    expect(await screen.findByText(/Note proposal · Create/)).toBeInTheDocument()
    expect(screen.getByText('Smugglers use the third pier.')).toBeInTheDocument()
  })

  it('accepts a proposal into canon', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: /Accept/ }))
    await waitFor(() => expect(api.callsTo('notes:approveSuggestion')).toHaveLength(1))
    const [suggestionId, edited] = api.callsTo('notes:approveSuggestion')[0] as [number, any]
    expect(suggestionId).toBe(70)
    expect(edited).toMatchObject({ title: 'The Piers', content: 'Smugglers use the third pier.' })
  })

  it('rejects a proposal', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(api.callsTo('notes:rejectSuggestion')).toContainEqual([70]))
  })

  it('lets the proposal be edited before it becomes canon', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Review before it becomes canon.' })
    const proposed = within(dialog).getByLabelText('Proposed text')
    await userEvent.clear(proposed)
    await userEvent.type(proposed, 'Smugglers use the second pier.')
    await userEvent.click(within(dialog).getByRole('button', { name: /Approve change/ }))

    await waitFor(() => expect(api.callsTo('notes:approveSuggestion')).toHaveLength(1))
    const [, edited] = api.callsTo('notes:approveSuggestion')[0] as [number, any]
    expect(edited.content).toBe('Smugglers use the second pier.')
  })

  it('gathers everything waiting for review in one place', async () => {
    renderRoute(route)
    await userEvent.click(await screen.findByRole('button', { name: /Review proposals/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Everything waiting for review.' })
    expect(within(dialog).getByText('The Piers')).toBeInTheDocument()
  })
})

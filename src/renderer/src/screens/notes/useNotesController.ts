import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WorldNote } from '@shared/types'
import { call } from '../../lib/api'
import { useIpcQuery } from '../../lib/queries'

export type NoteFilter = 'all' | 'recent' | 'pinned'

export interface NoteDraft {
  title: string
  content: string
  category: string
  contextMode: string
  isPinned: boolean
  dirty: boolean
}

export type NoteWithFingerprint = WorldNote & { fingerprint: string }

/**
 * Shared state for the notes explorer/editor: selection, search, filters,
 * collapsed categories, and unsaved per-note drafts that survive switching.
 */
export function useNotesController(worldId: number) {
  const client = useQueryClient()
  const notesQuery = useIpcQuery('notes:list', worldId)
  const usageQuery = useIpcQuery('notes:latestPromptUsage', worldId)
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data])

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<NoteFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Record<number, NoteDraft>>({})

  const current = notes.find((n) => n.id === selectedId) ?? null

  const refresh = useCallback((): void => {
    client.invalidateQueries({ queryKey: ['notes:list'] })
    client.invalidateQueries({ queryKey: ['notes:latestPromptUsage'] })
  }, [client])

  const select = useCallback(
    (noteId: number): void => {
      setSelectedId(noteId)
      void call('notes:touch', noteId).then(refresh)
    },
    [refresh]
  )

  const draftFor = useCallback(
    (note: NoteWithFingerprint): NoteDraft =>
      drafts[note.id] ?? {
        title: note.title,
        content: note.content,
        category: note.category,
        contextMode: note.contextMode,
        isPinned: note.isPinned,
        dirty: false
      },
    [drafts]
  )

  const updateDraft = useCallback((noteId: number, patch: Partial<NoteDraft>): void => {
    setDrafts((d) => {
      const base = d[noteId]
      if (!base) return d
      return { ...d, [noteId]: { ...base, ...patch, dirty: true } }
    })
  }, [])

  const beginDraft = useCallback(
    (note: NoteWithFingerprint): void => {
      setDrafts((d) => (d[note.id] ? d : { ...d, [note.id]: draftFor(note) }))
    },
    [draftFor]
  )

  const clearDraft = useCallback((noteId: number): void => {
    setDrafts((d) => {
      const next = { ...d }
      delete next[noteId]
      return next
    })
  }, [])

  const toggleCollapsed = useCallback((category: string): void => {
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }, [])

  /** Mirror of the main-process filter, applied to the cached list. */
  const visible = useMemo(() => {
    let result = [...notes]
    if (filter === 'pinned') result = result.filter((n) => n.isPinned)
    else if (filter === 'recent') {
      result.sort((a, b) =>
        (b.lastOpenedAt || b.updatedAt || b.createdAt).localeCompare(
          a.lastOpenedAt || a.updatedAt || a.createdAt
        )
      )
    }
    const needle = query.trim().toLowerCase()
    if (needle) {
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(needle) ||
          n.content.toLowerCase().includes(needle) ||
          n.category.toLowerCase().includes(needle)
      )
    }
    return result
  }, [notes, filter, query])

  return {
    notes,
    visible,
    usage: usageQuery.data ?? {},
    isLoaded: notesQuery.isSuccess,
    current,
    selectedId,
    select,
    setSelectedId,
    query,
    setQuery,
    filter,
    setFilter,
    collapsed,
    toggleCollapsed,
    draftFor,
    beginDraft,
    updateDraft,
    clearDraft,
    refresh
  }
}

export type NotesController = ReturnType<typeof useNotesController>

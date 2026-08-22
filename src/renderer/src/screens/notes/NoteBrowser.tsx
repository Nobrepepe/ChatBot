import { NOTE_CATEGORIES } from '@shared/types'
import { Rule, TextAction, TextTabs } from '../../components/primitives'
import type { NotesController } from './useNotesController'
import { call } from '../../lib/api'

const FILTERS = ['all', 'recent', 'pinned'] as const

export function NoteBrowser({
  ctl,
  onNewNote
}: {
  ctl: NotesController
  onNewNote: (category: string) => void
}): React.JSX.Element {
  const grouped = new Map<string, typeof ctl.visible>()
  for (const category of NOTE_CATEGORIES) grouped.set(category, [])
  for (const note of ctl.visible) {
    grouped.set(note.category, [...(grouped.get(note.category) ?? []), note])
  }
  const searching = !!ctl.query.trim() || ctl.filter !== 'all'

  return (
    <div className="block" style={{ gap: 'var(--space-3)', minHeight: 0, overflowY: 'auto' }}>
      <div className="field">
        <input
          placeholder="Search title or text…"
          value={ctl.query}
          onChange={(e) => ctl.setQuery(e.target.value)}
          aria-label="Search notes"
        />
      </div>
      <TextTabs
        items={FILTERS}
        labels={{ all: 'All', recent: 'Recent', pinned: 'Pinned' }}
        selected={ctl.filter}
        onSelect={ctl.setFilter}
        neutral
      />

      {[...grouped.entries()].map(([category, notes]) => {
        if (searching && notes.length === 0) return null
        const isCollapsed = ctl.collapsed.has(category) && !searching
        return (
          <div key={category} className="block" style={{ gap: 4 }}>
            <button
              type="button"
              className="disclosure-toggle"
              onClick={() => ctl.toggleCollapsed(category)}
            >
              {isCollapsed ? '▸' : '▾'} {category} · {notes.length}
            </button>
            {!isCollapsed
              ? notes.map((note) => {
                  const active = note.id === ctl.selectedId
                  const draft = ctl.draftFor(note)
                  const flags = [
                    note.isPinned ? 'Pinned' : null,
                    note.contextMode === 'always'
                      ? 'Always in context'
                      : note.contextMode === 'excluded'
                        ? 'Excluded'
                        : 'Relevant context',
                    draft.dirty ? 'Unsaved' : null
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <div key={note.id}>
                      <div className="row-line" style={{ padding: '7px 0' }}>
                        <button
                          type="button"
                          className="row-line"
                          style={{ flex: 1, padding: 0, minWidth: 0 }}
                          title={`Open note ${note.title}`}
                          onClick={() => ctl.select(note.id)}
                        >
                          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                            <span
                              className="row-title"
                              style={{
                                fontSize: '1rem',
                                color: active ? 'var(--accent)' : undefined,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            >
                              {note.title || 'Untitled'}
                            </span>
                            <span className="caption" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {note.content.split('\n')[0] || 'Empty'}
                            </span>
                            <span className="caption" style={{ fontFamily: 'monospace', fontSize: '0.62rem' }}>
                              {flags}
                            </span>
                          </span>
                        </button>
                        <TextAction
                          kind="secondary"
                          onClick={async () => {
                            await call('notes:save', {
                              id: note.id,
                              worldId: note.worldId,
                              title: note.title,
                              content: note.content,
                              category: note.category,
                              contextMode: note.contextMode,
                              isPinned: !note.isPinned
                            })
                            ctl.refresh()
                          }}
                        >
                          {note.isPinned ? 'Unpin' : 'Pin'}
                        </TextAction>
                      </div>
                      <Rule end={40 + ((note.id * 7) % 30)} />
                    </div>
                  )
                })
              : null}
          </div>
        )
      })}

      {ctl.visible.length === 0 && ctl.isLoaded ? (
        <p className="caption">
          {ctl.filter === 'pinned'
            ? 'No pinned notes yet.'
            : ctl.query
              ? 'No notes match this search.'
              : 'Create your first note for this world.'}
        </p>
      ) : null}

      <TextAction kind="secondary" onClick={() => onNewNote('Unsorted')}>
        New note →
      </TextAction>
    </div>
  )
}

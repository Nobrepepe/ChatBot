import { useEffect, useState } from 'react'
import { NOTE_CATEGORIES } from '@shared/types'
import { TextAction } from '../../components/primitives'
import { Field, SelectRow } from '../../components/fields'
import { Confirm, useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { call } from '../../lib/api'
import type { NotesController, NoteWithFingerprint } from './useNotesController'

const CONTEXT_OPTIONS = [
  { value: 'always', label: 'Always included' },
  { value: 'relevant', label: 'When relevant' },
  { value: 'excluded', label: 'Excluded from chat' }
]

export function statusText(
  note: NoteWithFingerprint,
  dirty: boolean,
  usage: Record<number, { fingerprint: string; reason: string }>
): string {
  if (dirty) return 'Unsaved — the assistant still sees the saved version'
  const used = usage[note.id]
  if (used && used.fingerprint === note.fingerprint) {
    return 'Saved · this version was used in the latest response'
  }
  if (used) return 'Saved · updated content will be included in your next message'
  return 'Saved · available to the next message when its context setting permits'
}

export function NoteEditor({
  ctl,
  note,
  lines = 12,
  onFocusMode
}: {
  ctl: NotesController
  note: NoteWithFingerprint
  lines?: number
  onFocusMode?: () => void
}): React.JSX.Element {
  const overlay = useOverlay()
  const { snack } = useSnack()
  const draft = ctl.draftFor(note)

  useEffect(() => {
    ctl.beginDraft(note)
  }, [note.id])

  async function save(): Promise<void> {
    try {
      await call('notes:save', {
        id: note.id,
        worldId: note.worldId,
        title: draft.title,
        content: draft.content,
        category: draft.category,
        contextMode: draft.contextMode,
        isPinned: draft.isPinned
      })
      ctl.clearDraft(note.id)
      ctl.refresh()
    } catch (err) {
      snack(`Save failed — your draft is preserved. ${(err as Error).message}`, true)
    }
  }

  return (
    <div className="block" style={{ gap: 'var(--space-3)', minHeight: 0, overflowY: 'auto' }}>
      <Field label="Title" value={draft.title} onChange={(v) => ctl.updateDraft(note.id, { title: v })} />
      <Field
        label="Note"
        value={draft.content}
        onChange={(v) => ctl.updateDraft(note.id, { content: v })}
        lines={lines}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <SelectRow
          label="Category"
          value={draft.category}
          options={NOTE_CATEGORIES.map((c) => ({ value: c, label: c }))}
          onChange={(v) => ctl.updateDraft(note.id, { category: v })}
        />
        <SelectRow
          label="Assistant context"
          value={draft.contextMode}
          options={CONTEXT_OPTIONS}
          onChange={(v) => ctl.updateDraft(note.id, { contextMode: v })}
        />
      </div>
      <p className="caption">{statusText(note, draft.dirty, ctl.usage)}</p>
      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <TextAction size={20} onClick={save}>
          Save note →
        </TextAction>
        <TextAction
          kind="secondary"
          onClick={() => ctl.updateDraft(note.id, { isPinned: !draft.isPinned })}
        >
          {draft.isPinned ? 'Unpin' : 'Pin'}
        </TextAction>
        {onFocusMode ? (
          <TextAction kind="secondary" onClick={onFocusMode} title="Open focus editor">
            Focus
          </TextAction>
        ) : null}
        <TextAction
          kind="secondary"
          onClick={async () => {
            const copy = await call('notes:duplicate', note.id)
            ctl.refresh()
            if (copy) ctl.select(copy.id)
          }}
        >
          Duplicate
        </TextAction>
        <TextAction
          kind="destructive"
          onClick={() =>
            overlay.open({
              eyebrow: 'Confirm',
              title: `Delete “${note.title || 'Untitled'}”?`,
              render: (close) => (
                <Confirm
                  body="Its content cannot be recovered."
                  actionLabel="Delete the note"
                  close={close}
                  onConfirm={async () => {
                    await call('notes:delete', note.id)
                    ctl.clearDraft(note.id)
                    ctl.setSelectedId(null)
                    ctl.refresh()
                  }}
                />
              )
            })
          }
        >
          Delete
        </TextAction>
      </div>
    </div>
  )
}

export function NewNoteBody({
  worldId,
  category,
  close,
  onCreated
}: {
  worldId: number
  category: string
  close: () => void
  onCreated: (id: number) => void
}): React.JSX.Element {
  const { snack } = useSnack()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [cat, setCat] = useState(category)
  const [context, setContext] = useState('relevant')
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="block">
      <Field label="Title" value={title} onChange={setTitle} autoFocus />
      <Field label="Note" value={content} onChange={setContent} lines={6} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <SelectRow label="Category" value={cat} options={NOTE_CATEGORIES.map((c) => ({ value: c, label: c }))} onChange={setCat} />
        <SelectRow label="Assistant context" value={context} options={CONTEXT_OPTIONS} onChange={setContext} />
      </div>
      <TextAction kind="secondary" onClick={() => setPinned(!pinned)}>
        {pinned ? 'Pinned' : 'Not pinned'} — toggle pin
      </TextAction>
      <div className="overlay-actions">
        <TextAction
          onClick={async () => {
            if (busy) return
            if (!title.trim()) {
              snack('A note needs a title.', true)
              return
            }
            setBusy(true)
            const id = await call('notes:save', {
              worldId,
              title: title.trim(),
              content,
              category: cat,
              contextMode: context,
              isPinned: pinned
            })
            onCreated(id)
            close()
          }}
        >
          Create note →
        </TextAction>
      </div>
    </div>
  )
}

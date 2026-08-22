import { useNavigate } from 'react-router-dom'
import type { World } from '@shared/types'
import { Eyebrow, Rule, TextAction, VRule } from '../../components/primitives'
import { useOverlay } from '../../components/overlay'
import { useNotesController } from './useNotesController'
import { NoteBrowser } from './NoteBrowser'
import { NewNoteBody, NoteEditor } from './NoteEditor'

/** World → Notes: the explorer/editor split without the AI conversation. */
export default function NotesListTab({ world }: { world: World }): React.JSX.Element {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const ctl = useNotesController(world.id)

  function newNote(category: string): void {
    overlay.open({
      eyebrow: 'Notes',
      title: 'Give the idea somewhere to live.',
      render: (close) => (
        <NewNoteBody
          worldId={world.id}
          category={category}
          close={close}
          onCreated={(id) => {
            ctl.refresh()
            ctl.select(id)
          }}
        />
      )
    })
  }

  return (
    <div className="block" style={{ gap: 'var(--space-4)' }}>
      <span style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Eyebrow>Private notes — never sent in scene prompts</Eyebrow>
        <TextAction kind="secondary" onClick={() => navigate(`/world/${world.id}/notes`)}>
          Open the AI workspace →
        </TextAction>
      </span>
      <Rule end={64} />
      <div style={{ display: 'flex', gap: 'var(--space-6)', minHeight: 420 }}>
        <div style={{ flex: 4, minWidth: 0 }}>
          <NoteBrowser ctl={ctl} onNewNote={newNote} />
        </div>
        <VRule />
        <div style={{ flex: 6, minWidth: 0 }}>
          {ctl.current ? (
            <NoteEditor ctl={ctl} note={ctl.current} lines={12} />
          ) : (
            <p className="body-text">Pick a note, or create the first one.</p>
          )}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { LoreEntry, World } from '@shared/types'
import { Eyebrow, Rule, TextAction } from '../../components/primitives'
import { Field, SelectRow } from '../../components/fields'
import { Confirm, useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { useIpcMutation, useIpcQuery } from '../../lib/queries'

function LoreEditor({
  world,
  entry,
  close
}: {
  world: World
  entry: LoreEntry | null
  close: () => void
}): React.JSX.Element {
  const { snack } = useSnack()
  const save = useIpcMutation('lore:save', ['lore:list'])
  const hubManaged = !!entry?.hubId
  const [draft, setDraft] = useState({
    title: entry?.title ?? '',
    content: entry?.content ?? '',
    keywords: entry?.keywords.join(', ') ?? '',
    alwaysInclude: entry?.alwaysInclude ? 'always' : 'keyword'
  })

  async function submit(): Promise<void> {
    if (!draft.title.trim()) {
      snack('Lore needs a title.', true)
      return
    }
    await save.mutateAsync([
      {
        id: entry?.id ?? null,
        worldId: world.id,
        title: draft.title,
        content: draft.content,
        keywords: draft.keywords.split(',').map((k) => k.trim()).filter(Boolean),
        alwaysInclude: draft.alwaysInclude === 'always'
      }
    ])
    snack('Lore saved.')
    close()
  }

  return (
    <div className="block">
      <Field label="Title" value={draft.title} readOnly={hubManaged}
        onChange={(v) => setDraft((d) => ({ ...d, title: v }))} autoFocus={!hubManaged} />
      <Field label="Lore" value={draft.content} lines={7} readOnly={hubManaged}
        onChange={(v) => setDraft((d) => ({ ...d, content: v }))} />
      <Field
        label="Trigger keywords"
        value={draft.keywords}
        onChange={(v) => setDraft((d) => ({ ...d, keywords: v }))}
        placeholder="comma, separated, keywords"
      />
      <SelectRow
        label="Included"
        value={draft.alwaysInclude}
        options={[
          { value: 'keyword', label: 'By keyword' },
          { value: 'always', label: 'Always' }
        ]}
        onChange={(v) => setDraft((d) => ({ ...d, alwaysInclude: v }))}
        disabled={hubManaged}
      />
      <p className="caption">
        {hubManaged
          ? 'Hub lore keeps its text; only the trigger keywords are yours to tune.'
          : 'Leave keywords empty only for lore that should always be included.'}
      </p>
      <div className="overlay-actions">
        <TextAction onClick={submit}>Save the lore →</TextAction>
      </div>
    </div>
  )
}

export default function LorebookTab({ world }: { world: World }): React.JSX.Element {
  const overlay = useOverlay()
  const lore = useIpcQuery('lore:list', world.id)
  const remove = useIpcMutation('lore:delete', ['lore:list'])
  const entries = lore.data ?? []
  const always = entries.filter((e) => e.alwaysInclude).length

  function openEditor(entry: LoreEntry | null): void {
    overlay.open({
      eyebrow: 'Lorebook',
      title: entry ? entry.title : 'A new piece of lore.',
      render: (close) => <LoreEditor world={world} entry={entry} close={close} />
    })
  }

  return (
    <div className="block" style={{ maxWidth: 720 }}>
      <p className="body-text">
        <span className="display" style={{ fontSize: 'var(--size-display-s)' }}>{entries.length}</span>{' '}
        entries; {always} always included and {entries.length - always} waiting for keywords.
      </p>
      <Rule end={60} />
      {entries.map((entry) => (
        <div key={entry.id}>
          <div className="row-line">
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="row-title">{entry.title}</span>
              <span className="caption">
                {entry.alwaysInclude
                  ? 'Always included'
                  : `Triggered by ${entry.keywords.length ? entry.keywords.join(', ') : 'no keywords'}`}
              </span>
            </span>
            <TextAction kind="secondary" onClick={() => openEditor(entry)}>
              {entry.hubId ? 'Tune keywords' : 'Edit'}
            </TextAction>
            {!entry.hubId ? (
              <TextAction
                kind="destructive"
                onClick={() =>
                  overlay.open({
                    eyebrow: 'Confirm',
                    title: `Delete “${entry.title}”?`,
                    render: (close) => (
                      <Confirm
                        body="This lore will no longer be available to any scene."
                        actionLabel="Delete the lore"
                        close={close}
                        onConfirm={() => remove.mutate([entry.id])}
                      />
                    )
                  })
                }
              >
                Delete
              </TextAction>
            ) : null}
          </div>
          <Rule end={52 + ((entry.id * 11) % 32)} />
        </div>
      ))}
      {!world.hubId ? (
        <div style={{ paddingTop: 'var(--space-2)' }}>
          <TextAction onClick={() => openEditor(null)} sub="Injected when its keywords appear in the scene.">
            New lore →
          </TextAction>
        </div>
      ) : null}
      {entries.length === 0 && lore.isSuccess ? (
        <>
          <Eyebrow>Nothing written</Eyebrow>
          <p className="body-text" style={{ maxWidth: 480 }}>
            Lore entries reach the model only when their keywords appear in the scene premise or
            recent messages — the world stays light until it is needed.
          </p>
        </>
      ) : null}
    </div>
  )
}

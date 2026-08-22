import { useState } from 'react'
import type { Persona } from '@shared/types'
import { Screen } from '../components/Screen'
import { Rule, TextAction } from '../components/primitives'
import { Field } from '../components/fields'
import { Confirm, useOverlay } from '../components/overlay'
import { useSnack } from '../components/snack'
import { useIpcMutation, useIpcQuery } from '../lib/queries'

function PersonaEditor({ persona, close }: { persona: Persona | null; close: () => void }): React.JSX.Element {
  const { snack } = useSnack()
  const save = useIpcMutation('personas:save', ['personas:list'])
  const [name, setName] = useState(persona?.name ?? '')
  const [description, setDescription] = useState(persona?.description ?? '')

  return (
    <div className="block">
      <Field
        label="Persona name"
        value={name}
        onChange={setName}
        placeholder="The name characters use for you"
        autoFocus
      />
      <Field
        label="Description"
        value={description}
        onChange={setDescription}
        lines={7}
        placeholder="Role, appearance, history, and how the cast should perceive you"
      />
      <p className="body-text">This description is sent with scenes that choose this persona.</p>
      <div className="overlay-actions">
        <TextAction
          onClick={async () => {
            if (!name.trim()) {
              snack('A persona needs a name.', true)
              return
            }
            await save.mutateAsync([{ id: persona?.id ?? null, name, description }])
            snack('Persona saved.')
            close()
          }}
        >
          Save the persona →
        </TextAction>
      </div>
    </div>
  )
}

export default function PersonasScreen(): React.JSX.Element {
  const overlay = useOverlay()
  const personas = useIpcQuery('personas:list')
  const remove = useIpcMutation('personas:delete', ['personas:list'])
  const list = personas.data ?? []

  function edit(persona: Persona | null): void {
    overlay.open({
      eyebrow: 'Personas',
      title: 'Who are you in the scene?',
      render: (close) => <PersonaEditor persona={persona} close={close} />
    })
  }

  const headline =
    list.length === 0
      ? 'You can enter as yourself, or name someone new.'
      : list.length === 1
        ? 'One way to enter a scene.'
        : `${list.length} ways to enter a scene.`

  return (
    <Screen back={{ label: 'Worlds', to: '/' }}>
      <h1 className="display">{headline}</h1>
      <section className="block" style={{ maxWidth: 640 }}>
        {list.map((persona) => (
          <div key={persona.id}>
            <div className="row-line">
              <button
                type="button"
                className="row-line"
                style={{ flex: 1, padding: 0 }}
                onClick={() => edit(persona)}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="row-title">{persona.name}</span>
                  <span className="caption">
                    {persona.description ? persona.description.slice(0, 140) : 'No description yet.'}
                  </span>
                </span>
              </button>
              <TextAction kind="secondary" onClick={() => edit(persona)}>
                Edit
              </TextAction>
              <TextAction
                kind="destructive"
                onClick={() =>
                  overlay.open({
                    eyebrow: 'Confirm',
                    title: `Delete ${persona.name}?`,
                    render: (close) => (
                      <Confirm
                        body="Scenes that use this persona will fall back to plain 'you'. Their conversations remain intact."
                        actionLabel={`Delete ${persona.name}`}
                        close={close}
                        onConfirm={() => remove.mutate([persona.id])}
                      />
                    )
                  })
                }
              >
                Delete
              </TextAction>
            </div>
            <Rule end={58 + ((persona.id * 9) % 26)} />
          </div>
        ))}
        <div style={{ paddingTop: 'var(--space-3)' }}>
          <TextAction onClick={() => edit(null)} sub="Sent with scenes that choose this persona.">
            New persona →
          </TextAction>
        </div>
      </section>
    </Screen>
  )
}

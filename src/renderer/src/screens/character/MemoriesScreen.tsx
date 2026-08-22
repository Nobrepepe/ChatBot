import { useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Memory, MemoryType } from '@shared/types'
import { Screen } from '../../components/Screen'
import { Eyebrow, HeroNumeral, PulseDot, Rule, TextAction } from '../../components/primitives'
import { Field } from '../../components/fields'
import { Art } from '../../components/art'
import { Confirm, useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { useIpcMutation, useIpcQuery } from '../../lib/queries'

export default function MemoriesScreen(): React.JSX.Element {
  const overlay = useOverlay()
  const { snack } = useSnack()
  const params = useParams<{ wid: string; cid: string }>()
  const worldId = Number(params.wid)
  const characterId = Number(params.cid)

  const characterQuery = useIpcQuery('characters:get', characterId)
  const memoriesQuery = useIpcQuery('memories:list', characterId, { status: 'any' })
  const save = useIpcMutation('memories:save', ['memories:list'])
  const remove = useIpcMutation('memories:delete', ['memories:list'])

  const character = characterQuery.data ?? null
  const all = memoriesQuery.data ?? []
  const canon = all.filter((m) => m.type === 'canon' && m.status === 'approved')
  const relationship = all.filter((m) => m.type === 'relationship' && m.status === 'approved')
  const pending = all.filter((m) => m.status === 'pending')
  const session = all.filter((m) => m.type === 'session')
  const injected = canon.length + relationship.length
  const [showSession, setShowSession] = useState(false)

  function editor(memory: Memory | null, type: MemoryType): void {
    overlay.open({
      eyebrow: 'Memory',
      title: 'What should remain true?',
      render: (close) => <MemoryEditor memory={memory} type={type} close={close} />
    })
  }

  function MemoryEditor({ memory, type, close }: { memory: Memory | null; type: MemoryType; close: () => void }): React.JSX.Element {
    const [text, setText] = useState(memory?.content ?? '')
    return (
      <div className="block">
        <Field label="Memory" value={text} onChange={setText} lines={6} autoFocus />
        <p className="caption">
          Canon and relationship memories are injected into every prompt for this character.
        </p>
        <div className="overlay-actions">
          <TextAction
            onClick={async () => {
              if (!text.trim()) {
                snack('A memory needs something true to carry.', true)
                return
              }
              await save.mutateAsync([
                { id: memory?.id ?? null, characterId, type, content: text.trim(), status: 'approved' }
              ])
              close()
            }}
          >
            Keep it →
          </TextAction>
        </div>
      </div>
    )
  }

  function rows(items: Memory[], review = false): React.JSX.Element[] {
    return items.map((memory) => (
      <div key={memory.id}>
        <div className="row-line">
          <span className="body-text" style={{ flex: 1 }}>{memory.content}</span>
          {review ? (
            <>
              <TextAction
                kind="secondary"
                onClick={() => save.mutate([{ ...memory, status: 'approved' }])}
              >
                Approve
              </TextAction>
              <TextAction kind="secondary" onClick={() => editor(memory, memory.type)}>
                Edit
              </TextAction>
              <TextAction kind="destructive" onClick={() => remove.mutate([memory.id])}>
                Reject
              </TextAction>
            </>
          ) : (
            <>
              <TextAction kind="secondary" onClick={() => editor(memory, memory.type)}>
                Edit
              </TextAction>
              <TextAction
                kind="destructive"
                onClick={() =>
                  overlay.open({
                    eyebrow: 'Confirm',
                    title: 'Forget this?',
                    render: (close) => (
                      <Confirm
                        body="It will no longer be sent with any scene."
                        actionLabel="Forget it"
                        close={close}
                        onConfirm={() => remove.mutate([memory.id])}
                      />
                    )
                  })
                }
              >
                Delete
              </TextAction>
            </>
          )}
        </div>
        <Rule end={52 + ((memory.id * 9) % 32)} />
      </div>
    ))
  }

  if (!character) return <Screen back={{ label: 'World', to: `/world/${worldId}/characters` }}>{null}</Screen>

  return (
    <Screen
      back={{ label: character.name, to: `/world/${worldId}/character/${characterId}` }}
      backdrop={
        character.portraitPath ? (
          <Art
            path={character.portraitPath}
            treatment="alpha"
            style={{ position: 'absolute', right: '-4%', bottom: 0, height: '86%', opacity: 0.55 }}
          />
        ) : null
      }
    >
      <h1 className="display" style={{ maxWidth: '14em' }}>
        {character.name} carries {injected === 0 ? 'nothing yet' : injected === 1 ? 'one memory' : `${injected} memories`} into every scene.
      </h1>
      <HeroNumeral value={injected} label="injected into every prompt" />

      <section className="block" style={{ maxWidth: 680 }}>
        <Eyebrow>Canon · permanently true</Eyebrow>
        {rows(canon)}
        <TextAction kind="secondary" onClick={() => editor(null, 'canon')}>
          Add canon →
        </TextAction>
      </section>

      <section className="block" style={{ maxWidth: 680 }}>
        <Eyebrow>Relationship · how they feel about you</Eyebrow>
        {rows(relationship)}
        <TextAction kind="secondary" onClick={() => editor(null, 'relationship')}>
          Add relationship →
        </TextAction>
      </section>

      <section className="block" style={{ maxWidth: 680 }}>
        <span style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <Eyebrow>Waiting for review</Eyebrow>
          {pending.length > 0 ? (
            <PulseDot label="blocking review" color="var(--bad)" />
          ) : (
            <span className="caption">nothing waiting</span>
          )}
        </span>
        {rows(pending, true)}
      </section>

      {session.length > 0 ? (
        <section className="block" style={{ maxWidth: 680 }}>
          <button type="button" className="disclosure-toggle" onClick={() => setShowSession(!showSession)}>
            Session memories, never sent to the model {showSession ? '⌃' : '⌄'}
          </button>
          {showSession ? rows(session) : null}
        </section>
      ) : null}
    </Screen>
  )
}

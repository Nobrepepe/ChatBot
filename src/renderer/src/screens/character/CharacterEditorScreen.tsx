import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Screen } from '../../components/Screen'
import { Eyebrow, Rule, TextAction } from '../../components/primitives'
import { Field } from '../../components/fields'
import { Art, ArtPlaceholder } from '../../components/art'
import { Confirm, useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { call } from '../../lib/api'
import { useIpcMutation, useIpcQuery } from '../../lib/queries'

type SectionKey =
  | 'appearance'
  | 'personality'
  | 'backstory'
  | 'behaviorRules'
  | 'voiceStyle'
  | 'relationshipToUser'
  | 'aiInstructions'
  | 'sprites'

const SECTIONS: { label: string; key: SectionKey }[] = [
  { label: 'Appearance', key: 'appearance' },
  { label: 'Personality', key: 'personality' },
  { label: 'Backstory', key: 'backstory' },
  { label: 'Behaviour', key: 'behaviorRules' },
  { label: 'Voice', key: 'voiceStyle' },
  { label: 'Relationship', key: 'relationshipToUser' },
  { label: 'Instructions', key: 'aiInstructions' },
  { label: 'Sprites', key: 'sprites' }
]

const SECTION_HINTS: Partial<Record<SectionKey, string>> = {
  appearance: 'What they look like, how they carry themselves.',
  personality: 'Temperament, wants, fears, contradictions.',
  backstory: 'Where they come from and what it left behind.',
  behaviorRules: 'Hard rules the model must follow when playing them.',
  voiceStyle: 'How they speak — rhythm, vocabulary, tics.',
  relationshipToUser: 'What they currently are to you.',
  aiInstructions: 'Direct instructions to the model, sent verbatim.'
}

export default function CharacterEditorScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { snack } = useSnack()
  const client = useQueryClient()
  const params = useParams<{ wid: string; cid?: string }>()
  const worldId = Number(params.wid)
  const characterId = params.cid ? Number(params.cid) : null

  const worldQuery = useIpcQuery('worlds:get', worldId)
  const characterQuery = useIpcQuery('characters:get', characterId ?? -1)
  const spritesQuery = useIpcQuery('sprites:list', characterId ?? -1)
  const character = characterId ? (characterQuery.data ?? null) : null
  const sprites = characterId ? (spritesQuery.data ?? []) : []
  const readOnly = !!character?.hubId

  const [selected, setSelected] = useState(0)
  const [draft, setDraft] = useState({
    name: '',
    nicknames: '',
    age: '',
    role: '',
    summary: '',
    appearance: '',
    personality: '',
    backstory: '',
    behaviorRules: '',
    voiceStyle: '',
    relationshipToUser: '',
    aiInstructions: '',
    portraitPath: '',
    tileImagePath: ''
  })

  useEffect(() => {
    if (character) {
      setDraft({
        name: character.name,
        nicknames: character.nicknames,
        age: character.age,
        role: character.role,
        summary: character.summary,
        appearance: character.appearance,
        personality: character.personality,
        backstory: character.backstory,
        behaviorRules: character.behaviorRules,
        voiceStyle: character.voiceStyle,
        relationshipToUser: character.relationshipToUser,
        aiInstructions: character.aiInstructions,
        portraitPath: character.portraitPath,
        tileImagePath: character.tileImagePath
      })
    }
  }, [character])

  const save = useIpcMutation('characters:save', ['characters:list', 'characters:get'])
  const remove = useIpcMutation('characters:delete', ['characters:list'])

  const set = (key: keyof typeof draft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const written = useMemo(
    () =>
      SECTIONS.map((s) =>
        s.key === 'sprites' ? sprites.length > 0 : Boolean(draft[s.key as keyof typeof draft]?.trim())
      ),
    [draft, sprites]
  )
  const writtenCount = written.filter(Boolean).length
  const firstMissing = SECTIONS[written.indexOf(false)]?.label

  async function saveCharacter(): Promise<number | null> {
    if (!draft.name.trim()) {
      snack('A character needs a name.', true)
      return null
    }
    try {
      const id = await save.mutateAsync([{ id: characterId, worldId, ...draft }])
      snack('Character saved.')
      if (!characterId) navigate(`/world/${worldId}/character/${id}`, { replace: true })
      return id
    } catch (err) {
      snack((err as Error).message, true)
      return null
    }
  }

  async function importImage(kind: 'portrait' | 'tile'): Promise<void> {
    const worldName = worldQuery.data?.name ?? 'world'
    if (!draft.name.trim()) {
      snack('Name the character before importing art.', true)
      return
    }
    const path = await call('assets:importImage', {
      kind: 'characterImage',
      worldName,
      characterName: draft.name
    })
    if (!path) return
    const key = kind === 'portrait' ? 'portraitPath' : 'tileImagePath'
    setDraft((d) => ({ ...d, [key]: path }))
    if (characterId) {
      await save.mutateAsync([{ id: characterId, worldId, ...draft, [key]: path }])
      snack(kind === 'portrait' ? 'Portrait imported.' : 'Shelf image imported.')
    }
  }

  const selectedSection = SECTIONS[selected]!

  function openSpriteEditor(sprite: import('@shared/types').CharacterSprite | null): void {
    if (!characterId) return
    overlay.open({
      eyebrow: 'Sprites',
      title: sprite ? sprite.name : 'A new expression.',
      render: (close) => <SpriteEditor sprite={sprite} close={close} />
    })
  }

  function SpriteEditor({
    sprite,
    close
  }: {
    sprite: import('@shared/types').CharacterSprite | null
    close: () => void
  }): React.JSX.Element {
    const [name, setName] = useState(sprite?.name ?? '')
    const [callSign, setCallSign] = useState(sprite?.callSign ?? '')
    const [imagePath, setImagePath] = useState(sprite?.imagePath ?? '')
    return (
      <div className="block">
        {imagePath ? (
          <Art path={imagePath} treatment="alpha" style={{ width: 170, maxHeight: 220 }} />
        ) : (
          <ArtPlaceholder label="NO ART" aspect="3/4" style={{ width: 170 }} />
        )}
        <TextAction
          kind="secondary"
          onClick={async () => {
            const path = await call('assets:importImage', {
              kind: 'characterImage',
              worldName: worldQuery.data?.name ?? 'world',
              characterName: draft.name || 'character'
            })
            if (path) setImagePath(path)
          }}
        >
          Import sprite art →
        </TextAction>
        <Field label="Sprite name" value={name} onChange={setName} placeholder="Sad" />
        <Field label="Call sign" value={callSign} onChange={setCallSign} placeholder="sad" />
        <p className="caption">
          Lowercase letters, digits, - and _. The reply chooses the sprite by starting with the
          call sign in brackets, like [sad].
        </p>
        <div className="overlay-actions">
          <TextAction
            onClick={async () => {
              if (!imagePath) {
                snack('Import sprite art first.', true)
                return
              }
              if (!name.trim()) {
                snack('Name the sprite.', true)
                return
              }
              try {
                await call('sprites:save', {
                  id: sprite?.id ?? null,
                  characterId: characterId!,
                  name: name.trim(),
                  callSign,
                  imagePath
                })
                client.invalidateQueries({ queryKey: ['sprites:list'] })
                close()
              } catch (err) {
                snack((err as Error).message, true)
              }
            }}
          >
            Keep the sprite →
          </TextAction>
        </div>
      </div>
    )
  }

  return (
    <Screen
      back={{ label: worldQuery.data?.name ?? 'World', to: `/world/${worldId}/characters` }}
      rightActions={
        characterId ? (
          <TextAction
            kind="secondary"
            onClick={() => navigate(`/world/${worldId}/character/${characterId}/memories`)}
          >
            Memories →
          </TextAction>
        ) : null
      }
      backdrop={
        draft.portraitPath ? (
          <>
            <Art
              path={draft.portraitPath}
              treatment="alpha"
              style={{ position: 'absolute', right: '-6%', bottom: 0, height: '92%', opacity: 0.34 }}
            />
            <div className="scrim-side" />
          </>
        ) : null
      }
    >
      <h1 className="display" style={{ fontSize: 'var(--size-display-xl)', lineHeight: 1 }}>
        {draft.name || 'Someone new.'}
      </h1>
      <p className="body-text" style={{ maxWidth: 560 }}>
        {writtenCount === SECTIONS.length
          ? 'All eight profile sections are written — the model has a full voice to follow.'
          : `${writtenCount} of the eight profile sections are written — ${firstMissing} is still empty, so the model must improvise it.`}
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div className="block" style={{ flex: '0 1 300px' }}>
          <Eyebrow>Portrait</Eyebrow>
          {draft.portraitPath ? (
            <Art path={draft.portraitPath} treatment="alpha" style={{ width: '100%', maxHeight: 380 }} />
          ) : (
            <ArtPlaceholder label="NO PORTRAIT" aspect="3/4" style={{ width: 220 }} />
          )}
          <Eyebrow>Shelf image</Eyebrow>
          {draft.tileImagePath ? (
            <Art path={draft.tileImagePath} treatment="alpha" style={{ width: '100%' }} />
          ) : (
            <ArtPlaceholder label="NO ART" aspect="16/9" style={{ width: 220 }} />
          )}
        </div>

        <div className="block" style={{ flex: '1 1 420px', maxWidth: 800 }}>
          <Eyebrow>Basics</Eyebrow>
          <Field label="Name" value={draft.name} onChange={set('name')} readOnly={readOnly} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
            <Field label="Nicknames" value={draft.nicknames} onChange={set('nicknames')} readOnly={readOnly} />
            <Field label="Age" value={draft.age} onChange={set('age')} readOnly={readOnly} />
            <Field label="Role" value={draft.role} onChange={set('role')} readOnly={readOnly} />
          </div>
          <Field label="Summary" value={draft.summary} onChange={set('summary')} lines={2} readOnly={readOnly} />

          <div style={{ paddingTop: 'var(--space-4)' }}>
            <Eyebrow>Profile · {writtenCount} written, {SECTIONS.length - writtenCount} empty</Eyebrow>
          </div>
          <div className="dot-path" role="tablist">
            {SECTIONS.map((section, i) => (
              <button
                key={section.key}
                type="button"
                role="tab"
                aria-selected={i === selected}
                className="dot-step"
                data-state={i === selected ? 'current' : written[i] ? 'written' : 'empty'}
                onClick={() => setSelected(i)}
              >
                <span className="dot-step-dot" />
                <span className="dot-step-name">{section.label}</span>
                <span className="dot-step-status">{written[i] ? 'written' : 'empty'}</span>
              </button>
            ))}
          </div>

          <div style={{ paddingTop: 'var(--space-3)' }}>
            {selectedSection.key === 'sprites' ? (
              <div className="block">
                <p className="body-text">
                  {sprites.length === 0
                    ? 'No custom sprites yet. Call signs let replies choose another expression.'
                    : `${sprites.length} custom sprites. Call signs let replies choose another expression.`}
                </p>
                {sprites.map((sprite) => (
                  <div key={sprite.id}>
                    <div className="row-line">
                      <Art path={sprite.imagePath} treatment="alpha" style={{ width: 52, height: 66 }} />
                      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span className="row-title" style={{ fontSize: '1rem' }}>{sprite.name}</span>
                        <span className="caption">[{sprite.callSign}]</span>
                      </span>
                      {!readOnly ? (
                        <>
                          <TextAction kind="secondary" onClick={() => openSpriteEditor(sprite)}>
                            Edit
                          </TextAction>
                          <TextAction
                            kind="destructive"
                            onClick={async () => {
                              await call('sprites:delete', sprite.id)
                              client.invalidateQueries({ queryKey: ['sprites:list'] })
                            }}
                          >
                            Delete
                          </TextAction>
                        </>
                      ) : null}
                    </div>
                    <Rule end={56 + ((sprite.id * 9) % 28)} />
                  </div>
                ))}
                {!readOnly && characterId ? (
                  <TextAction kind="secondary" onClick={() => openSpriteEditor(null)}>
                    New sprite →
                  </TextAction>
                ) : null}
                {!characterId ? (
                  <p className="caption">Save the character first, then add sprites.</p>
                ) : null}
              </div>
            ) : (
              <Field
                label={selectedSection.label}
                value={draft[selectedSection.key as Exclude<SectionKey, 'sprites'>]}
                onChange={set(selectedSection.key as Exclude<SectionKey, 'sprites'>)}
                lines={6}
                readOnly={readOnly}
                placeholder={SECTION_HINTS[selectedSection.key]}
              />
            )}
          </div>

          <Rule end={70} />
          {readOnly ? (
            <p className="caption" style={{ maxWidth: 520 }}>
              This character comes from a World Hub publication and is read-only here. Updates
              arrive through Settings → World Hub content.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <TextAction onClick={saveCharacter}>Save {draft.name || 'the character'} →</TextAction>
              <TextAction kind="secondary" onClick={() => importImage('portrait')}>
                Import a portrait →
              </TextAction>
              <TextAction kind="secondary" onClick={() => importImage('tile')}>
                Import a shelf image →
              </TextAction>
              {character ? (
                <TextAction
                  kind="destructive"
                  onClick={() =>
                    overlay.open({
                      eyebrow: 'Confirm',
                      title: `Delete ${character.name}?`,
                      render: (close) => (
                        <Confirm
                          body="Their profile, sprites and memories will be removed."
                          actionLabel={`Delete ${character.name}`}
                          close={close}
                          onConfirm={async () => {
                            await remove.mutateAsync([character.id])
                            navigate(`/world/${worldId}/characters`)
                          }}
                        />
                      )
                    })
                  }
                >
                  Delete
                </TextAction>
              ) : null}
            </div>
          )}
        </div>

      </div>
    </Screen>
  )
}

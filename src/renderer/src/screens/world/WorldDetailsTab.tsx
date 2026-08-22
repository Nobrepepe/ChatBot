import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { World } from '@shared/types'
import { Eyebrow, Rule, TextAction, TextTabs } from '../../components/primitives'
import { Field } from '../../components/fields'
import { Art, ArtPlaceholder } from '../../components/art'
import { Confirm, useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { call } from '../../lib/api'
import { useIpcMutation } from '../../lib/queries'

const SUBTABS = ['Identity', 'Setting', 'Art'] as const

interface Props {
  world: World | null
}

export default function WorldDetailsTab({ world }: Props): React.JSX.Element {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { snack } = useSnack()
  const [subtab, setSubtab] = useState<(typeof SUBTABS)[number]>('Identity')
  const readOnly = !!world?.hubId

  const [draft, setDraft] = useState({
    name: '',
    genre: '',
    tone: '',
    summary: '',
    settingDescription: '',
    styleGuide: '',
    coverImagePath: '',
    sessionBackgroundPath: ''
  })

  useEffect(() => {
    if (world) {
      setDraft({
        name: world.name,
        genre: world.genre,
        tone: world.tone,
        summary: world.summary,
        settingDescription: world.settingDescription,
        styleGuide: world.styleGuide,
        coverImagePath: world.coverImagePath,
        sessionBackgroundPath: world.sessionBackgroundPath
      })
    }
  }, [world])

  const save = useIpcMutation('worlds:save', ['worlds:list', 'worlds:get'])
  const remove = useIpcMutation('worlds:delete', ['worlds:list'])

  const set = (key: keyof typeof draft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function saveWorld(overrides: Partial<typeof draft> = {}): Promise<void> {
    const merged = { ...draft, ...overrides }
    if (!merged.name.trim()) {
      snack('A world needs a name.', true)
      return
    }
    try {
      const id = await save.mutateAsync([{ id: world?.id ?? null, ...merged }])
      snack('World saved.')
      if (!world) navigate(`/world/${id}`)
    } catch (err) {
      snack((err as Error).message, true)
    }
  }

  async function importArt(kind: 'worldCover' | 'sessionBackground'): Promise<void> {
    const name = draft.name.trim()
    if (!name) {
      snack('Name the world before importing art.', true)
      return
    }
    const path = await call('assets:importImage', { kind, worldName: name })
    if (!path) return
    const key = kind === 'worldCover' ? 'coverImagePath' : 'sessionBackgroundPath'
    setDraft((d) => ({ ...d, [key]: path }))
    await saveWorld({ [key]: path })
  }

  function artBlock(label: string, key: 'coverImagePath' | 'sessionBackgroundPath', kind: 'worldCover' | 'sessionBackground'): React.JSX.Element {
    return (
      <div className="block" style={{ maxWidth: 470 }}>
        <Eyebrow>{label}</Eyebrow>
        {draft[key] ? (
          <Art path={draft[key]} treatment="masked" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }} />
        ) : (
          <ArtPlaceholder label="NO ART" aspect="16/9" />
        )}
        {!readOnly ? (
          <TextAction kind="secondary" onClick={() => importArt(kind)}>
            Import an image →
          </TextAction>
        ) : null}
      </div>
    )
  }

  return (
    <div className="block" style={{ gap: 'var(--space-5)' }}>
      <TextTabs items={SUBTABS} selected={subtab} onSelect={setSubtab} neutral />

      {subtab === 'Identity' ? (
        <div className="block" style={{ maxWidth: 640 }}>
          <Field label="Name" value={draft.name} onChange={set('name')} readOnly={readOnly} />
          <Field label="Genre" value={draft.genre} onChange={set('genre')} readOnly={readOnly} />
          <Field label="Tone" value={draft.tone} onChange={set('tone')} readOnly={readOnly} />
          <Field label="Summary" value={draft.summary} onChange={set('summary')} lines={3} readOnly={readOnly} />
        </div>
      ) : null}

      {subtab === 'Setting' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-5)' }}>
          <Field
            label="Setting description"
            value={draft.settingDescription}
            onChange={set('settingDescription')}
            lines={7}
            readOnly={readOnly}
            placeholder="The places, rules and texture of this world."
          />
          <Field
            label="Style guide"
            value={draft.styleGuide}
            onChange={set('styleGuide')}
            lines={7}
            readOnly={readOnly}
            placeholder="How scenes here should be written."
          />
        </div>
      ) : null}

      {subtab === 'Art' ? (
        <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
          {artBlock('World cover', 'coverImagePath', 'worldCover')}
          {artBlock('Scene fallback', 'sessionBackgroundPath', 'sessionBackground')}
        </div>
      ) : null}

      <Rule end={68} />

      {readOnly ? (
        <p className="caption" style={{ maxWidth: 520 }}>
          This world comes from a World Hub publication and is read-only here. Updates arrive
          through Settings → World Hub content.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'baseline' }}>
          <TextAction onClick={() => saveWorld()}>Save the world →</TextAction>
          {world ? (
            <TextAction
              kind="destructive"
              onClick={() =>
                overlay.open({
                  eyebrow: 'Confirm',
                  title: `Delete ${world.name}?`,
                  render: (close) => (
                    <Confirm
                      body="Its characters, scenes, chats, lore and memories will be removed."
                      actionLabel={`Delete ${world.name}`}
                      close={close}
                      onConfirm={async () => {
                        await remove.mutateAsync([world.id])
                        navigate('/')
                      }}
                    />
                  )
                })
              }
            >
              Delete {world.name}
            </TextAction>
          ) : null}
        </div>
      )}
    </div>
  )
}

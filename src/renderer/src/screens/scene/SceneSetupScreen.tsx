import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { SceneMode } from '@shared/types'
import { Screen } from '../../components/Screen'
import { Eyebrow, PulseDot, Rule, TextAction, TextTabs } from '../../components/primitives'
import { Field, SelectRow } from '../../components/fields'
import { Art, ArtPlaceholder } from '../../components/art'
import { useOverlay } from '../../components/overlay'
import { useSnack } from '../../components/snack'
import { call } from '../../lib/api'
import { useIpcQuery } from '../../lib/queries'

const MODES = ['Roleplay', 'Interview', 'Author assistant'] as const
const MODE_VALUE: Record<(typeof MODES)[number], SceneMode> = {
  Roleplay: 'roleplay',
  Interview: 'interview',
  'Author assistant': 'author'
}
/** Router state a continued scene arrives with. */
export interface ScenePrefill {
  title?: string
  previouslyOn?: string
  characterIds?: number[]
}

const MODE_LABEL: Record<SceneMode, (typeof MODES)[number]> = {
  roleplay: 'Roleplay',
  interview: 'Interview',
  author: 'Author assistant'
}

export default function SceneSetupScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const { snack } = useSnack()
  const params = useParams<{ wid: string; templateId?: string }>()
  const worldId = Number(params.wid)
  const prefill = useLocation().state as ScenePrefill | null

  const world = useIpcQuery('worlds:get', worldId)
  const charactersQuery = useIpcQuery('characters:list', worldId)
  const personasQuery = useIpcQuery('personas:list')
  const templatesQuery = useIpcQuery('templates:list', worldId)

  const [cast, setCast] = useState<Set<number>>(new Set())
  const [title, setTitle] = useState('')
  const [previouslyOn, setPreviouslyOn] = useState('')
  const [mode, setMode] = useState<(typeof MODES)[number]>('Roleplay')
  const [personaId, setPersonaId] = useState('')
  const [narrator, setNarrator] = useState('off')
  const [loadedTemplate, setLoadedTemplate] = useState<number | null>(null)
  const [seeded, setSeeded] = useState(false)

  const characters = charactersQuery.data ?? []
  const templates = templatesQuery.data ?? []

  function applyTemplate(templateId: number): void {
    const template = templates.find((t) => t.id === templateId)
    if (!template) return
    const validIds = new Set(characters.map((c) => c.id))
    setCast(new Set(template.characterIds.filter((id) => validIds.has(id))))
    setTitle(template.title)
    setPreviouslyOn(template.previouslyOn)
    setMode(MODE_LABEL[template.mode])
    setPersonaId(template.personaId ? String(template.personaId) : '')
    setNarrator(template.narratorEnabled ? 'on' : 'off')
    setLoadedTemplate(templateId)
  }

  useEffect(() => {
    if (params.templateId && templates.length && characters.length && loadedTemplate === null) {
      applyTemplate(Number(params.templateId))
    }
  }, [params.templateId, templates, characters])

  // A scene continued from another arrives with its cast, its next title and
  // the earlier summary already written; the writer still begins it by hand.
  useEffect(() => {
    if (seeded || !prefill || !characters.length) return
    const validIds = new Set(characters.map((c) => c.id))
    setCast(new Set((prefill.characterIds ?? []).filter((id) => validIds.has(id))))
    setTitle(prefill.title ?? '')
    setPreviouslyOn(prefill.previouslyOn ?? '')
    setSeeded(true)
  }, [prefill, characters, seeded])

  const ready = cast.size > 0

  function toggle(id: number): void {
    setCast((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function sceneTitle(): string {
    return title.trim().slice(0, 120) || 'New scene'
  }

  async function begin(): Promise<void> {
    if (!ready) return
    const sceneId = await call('scenes:save', {
      worldId,
      title: sceneTitle(),
      previouslyOn,
      mode: MODE_VALUE[mode],
      narratorEnabled: narrator === 'on',
      personaId: personaId ? Number(personaId) : null,
      characterIds: [...cast]
    })
    navigate(`/chat/${sceneId}`)
  }

  function saveTemplate(): void {
    if (!ready) {
      snack('Pick at least one character first.', true)
      return
    }
    overlay.open({
      eyebrow: 'Scene setup',
      title: 'Name this setup.',
      render: (close) => <TemplateNamer close={close} />
    })
  }

  function TemplateNamer({ close }: { close: () => void }): React.JSX.Element {
    const [name, setName] = useState(sceneTitle())
    return (
      <div className="block">
        <Field label="Setup name" value={name} onChange={setName} autoFocus />
        <div className="overlay-actions">
          <TextAction
            onClick={async () => {
              if (!name.trim()) return
              await call('templates:save', {
                worldId,
                name: name.trim(),
                title,
                previouslyOn,
                mode: MODE_VALUE[mode],
                narratorEnabled: narrator === 'on',
                personaId: personaId ? Number(personaId) : null,
                characterIds: [...cast]
              })
              snack('Setup saved. Find it under Sessions.')
              close()
            }}
          >
            Save the setup →
          </TextAction>
        </div>
      </div>
    )
  }

  return (
    <Screen
      back={{ label: world.data?.name ?? 'World', to: `/world/${worldId}/sessions` }}
      rightActions={
        templates.length > 0 ? (
          <SelectRow
            label="Saved setup"
            value={loadedTemplate ? String(loadedTemplate) : ''}
            options={[
              { value: '', label: 'None' },
              ...templates.map((t) => ({ value: String(t.id), label: t.name }))
            ]}
            onChange={(v) => (v ? applyTemplate(Number(v)) : setLoadedTemplate(null))}
          />
        ) : null
      }
    >
      <h1 className="display">Will this start?</h1>

      <section className="block">
        <Eyebrow>Cast · click to include</Eyebrow>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 'var(--space-4)'
          }}
        >
          {characters.map((c) => {
            const chosen = cast.has(c.id)
            const art = c.tileImagePath || c.portraitPath
            return (
              <button
                key={c.id}
                type="button"
                className="row-line"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                onClick={() => toggle(c.id)}
              >
                {art ? (
                  <Art path={art} treatment="alpha" ghost={!chosen} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'contain' }} />
                ) : (
                  <ArtPlaceholder label="NO PORTRAIT" aspect="16/9" />
                )}
                <span className="row-title" style={{ fontSize: 'var(--size-title)' }}>{c.name}</span>
                <span className="caption" style={chosen ? { color: 'var(--accent)' } : undefined}>
                  {chosen ? 'in this scene' : 'not in this scene'}
                </span>
              </button>
            )
          })}
        </div>
        {characters.length === 0 && charactersQuery.isSuccess ? (
          <p className="body-text">No characters in this world yet — make one first.</p>
        ) : null}
      </section>

      <Rule end={64} />

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-5)', maxWidth: 900 }}>
        <div className="block">
          <Field label="Title" value={title} onChange={setTitle} placeholder="What is this scene called?" />
          <Field
            label="Previously on"
            value={previouslyOn}
            onChange={setPreviouslyOn}
            lines={5}
            placeholder="Summaries of earlier scenes — where things stand as this one opens."
          />
          <p className="caption">Sent with every message in this scene, before the transcript.</p>
        </div>
        <div className="block">
          <Eyebrow>Mode</Eyebrow>
          <TextTabs items={MODES} selected={mode} onSelect={setMode} neutral />
          <SelectRow
            label="You are"
            value={personaId}
            options={[
              { value: '', label: "Plain 'you'" },
              ...(personasQuery.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))
            ]}
            onChange={setPersonaId}
          />
          <SelectRow
            label="Narrator"
            value={narrator}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' }
            ]}
            onChange={setNarrator}
          />
        </div>
      </section>

      <Rule end={58} />

      <section style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <TextAction
          size={34}
          onClick={begin}
          disabled={!ready}
          sub="The scene is created when you begin it — nothing is written until then."
        >
          Begin the scene →
        </TextAction>
        {ready ? <PulseDot label="ready" /> : <span className="caption">not ready — pick a character</span>}
        <TextAction kind="secondary" onClick={saveTemplate}>
          Save setup as template
        </TextAction>
      </section>
    </Screen>
  )
}

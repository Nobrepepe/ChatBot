import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { applyAccessibility } from '../../App'
import { Screen } from '../../components/Screen'
import { Eyebrow, FadingBar, PulseDot, Rule, TextAction, TextTabs } from '../../components/primitives'
import { Field, SelectRow } from '../../components/fields'
import { useSnack } from '../../components/snack'
import { call } from '../../lib/api'
import { useIpcQuery } from '../../lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import WorldHubSection from './WorldHubSection'

const SECTIONS = ['Endpoint', 'Generation', 'Appearance', 'World Hub'] as const

export default function SettingsScreen(): React.JSX.Element {
  const { snack } = useSnack()
  const client = useQueryClient()
  const settingsQuery = useIpcQuery('settings:get')
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('Endpoint')
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [test, setTest] = useState<{ latencyMs: number; models: string[] } | null>(null)

  useEffect(() => {
    if (settingsQuery.data && !draft) setDraft(settingsQuery.data)
  }, [settingsQuery.data, draft])

  if (!draft) return <Screen back={{ label: 'Worlds', to: '/' }}>{null}</Screen>

  const set = (key: keyof AppSettings) => (value: string) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))

  async function persist(values: AppSettings, show = true): Promise<void> {
    for (const [label, value] of [
      ['Temperature', values.temperature],
      ['Top-p', values.topP],
      ['Max tokens', values.maxTokens],
      ['History window', values.historyLimit],
      ['Lore budget', values.loreBudget]
    ] as const) {
      if (Number.isNaN(Number(value))) {
        snack(`${label} needs a number.`, true)
        return
      }
    }
    await call('settings:save', values)
    client.invalidateQueries({ queryKey: ['settings:get'] })
    if (show) snack('Settings saved. Nothing changes the model until the next request.')
  }

  async function testConnection(): Promise<void> {
    if (!draft) return
    try {
      const result = await call('provider:test', draft)
      setTest(result)
      const next = { ...draft, model: draft.model || result.models[0] || '' }
      setDraft(next)
      await persist(next, false)
    } catch (err) {
      setTest(null)
      snack((err as Error).message, true)
    }
  }

  const headline = test
    ? `The endpoint answered in ${test.latencyMs} ms.`
    : `Nothing tested yet at ${draft.baseUrl || 'no endpoint'}.`
  const subline = `You are talking to ${draft.model || 'no model'}, ${
    draft.streaming === '1' ? 'streaming' : 'waiting for complete replies'
  }, at temperature ${draft.temperature}.`

  return (
    <Screen back={{ label: 'Worlds', to: '/' }}>
      <h1 className="display" style={{ maxWidth: '16em' }}>{headline}</h1>
      <p className="body-text">{subline}</p>

      <TextTabs items={SECTIONS} selected={section} onSelect={setSection} />

      {section === 'Endpoint' ? (
        <div className="block" style={{ maxWidth: 620 }}>
          <Field label="Base URL" value={draft.baseUrl} onChange={set('baseUrl')} placeholder="http://localhost:11434/v1" />
          <Field label="API key" value={draft.apiKey} onChange={set('apiKey')} type="password" placeholder="Empty for local servers" />
          {test && test.models.length > 0 ? (
            <SelectRow
              label="Models found"
              value={draft.model}
              options={test.models.map((m) => ({ value: m, label: m }))}
              onChange={set('model')}
            />
          ) : (
            <Field label="Model" value={draft.model} onChange={set('model')} />
          )}
          <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'baseline' }}>
            <TextAction kind="secondary" onClick={testConnection}>
              Test the connection →
            </TextAction>
            {test ? <PulseDot label="live" color="var(--good)" /> : <span className="caption">not tested</span>}
          </div>
          <Rule end={64} />
          <Field
            label="System prompt"
            value={draft.systemPrompt}
            onChange={set('systemPrompt')}
            lines={5}
            placeholder="Sent before character, world, scene, lore and memory context."
          />
        </div>
      ) : null}

      {section === 'Generation' ? (
        <div className="block" style={{ maxWidth: 520 }}>
          <Field label="Temperature" value={draft.temperature} onChange={set('temperature')} />
          <FadingBar fill={Number(draft.temperature) / 2 || 0} width={330} />
          <Field label="Top-p" value={draft.topP} onChange={set('topP')} />
          <Field label="Max tokens" value={draft.maxTokens} onChange={set('maxTokens')} />
          <Field label="History window" value={draft.historyLimit} onChange={set('historyLimit')} />
          <FadingBar fill={Number(draft.historyLimit) / 100 || 0} width={330} />
          <p className="caption">How many recent messages are sent with each request.</p>
          <Field label="Lore budget" value={draft.loreBudget} onChange={set('loreBudget')} />
          <FadingBar fill={Number(draft.loreBudget) / 20000 || 0} width={330} />
          <p className="caption">
            Characters of matched lore sent with each request. Long entries are trimmed to fit
            rather than dropped. 0 sends every match, however long.
          </p>
          <Rule end={58} />
          <Eyebrow>Replies</Eyebrow>
          <TextTabs
            items={['1', '0'] as const}
            labels={{ '1': 'Streaming', '0': 'Complete replies' }}
            selected={draft.streaming === '1' ? '1' : '0'}
            onSelect={(v) => set('streaming')(v)}
            neutral
          />
          <p className="body-text" style={{ maxWidth: 440 }}>
            Streaming shows the reply as it is written; complete replies arrive all at once.
          </p>
        </div>
      ) : null}

      {section === 'Appearance' ? (
        <div className="block" style={{ maxWidth: 520 }}>
          <Eyebrow>How scenes are shown</Eyebrow>
          <TextTabs
            items={['chat', 'vn'] as const}
            labels={{ chat: 'Rolling chat', vn: 'Visual novel' }}
            selected={draft.displayMode === 'vn' ? 'vn' : 'chat'}
            onSelect={(v) => set('displayMode')(v)}
            neutral
          />
          <Rule end={66} />
          <Eyebrow>Reading</Eyebrow>
          <TextTabs
            items={['0', '1'] as const}
            labels={{ '0': 'Full motion', '1': 'Reduced' }}
            selected={draft.reduceMotion === '1' ? '1' : '0'}
            onSelect={(v) => {
              set('reduceMotion')(v)
              applyAccessibility(v === '1', Number(draft.textScale) || 1)
            }}
            neutral
          />
          <TextTabs
            items={['1.0', '1.2', '1.4'] as const}
            labels={{ '1.0': 'Standard', '1.2': 'Comfortable', '1.4': 'Large' }}
            selected={(['1.0', '1.2', '1.4'] as const).includes(draft.textScale as never) ? (draft.textScale as '1.0') : '1.0'}
            onSelect={(v) => {
              set('textScale')(v)
              applyAccessibility(draft.reduceMotion === '1', Number(v))
            }}
            neutral
          />
          <p className="caption">Headlines scale and wrap; interface text remains stable.</p>
        </div>
      ) : null}

      {section === 'World Hub' ? <WorldHubSection /> : null}

      <Rule end={72} />
      <TextAction onClick={() => draft && persist(draft)} sub="Nothing changes the model until the next request.">
        Save settings →
      </TextAction>
    </Screen>
  )
}

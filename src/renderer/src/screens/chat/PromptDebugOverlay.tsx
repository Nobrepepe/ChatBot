import { useEffect, useState } from 'react'
import type { PromptDebugInfo } from '@shared/ipc'
import { Eyebrow, Rule } from '../../components/primitives'
import { call } from '../../lib/api'

const mono: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.72rem',
  whiteSpace: 'pre-wrap',
  color: 'var(--text-dim)',
  userSelect: 'text',
  margin: 0,
  overflowWrap: 'anywhere'
}

/** Every prompt section plus the exact payload messages sent to the model. */
export function PromptDebugBody({ sceneId }: { sceneId: number }): React.JSX.Element {
  const [info, setInfo] = useState<PromptDebugInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    call('chat:promptDebug', sceneId).then(setInfo, (err) => setError((err as Error).message))
  }, [sceneId])

  if (error) return <p className="body-text">{error}</p>
  if (!info) return <p className="caption">Building the prompt…</p>

  return (
    <div className="block" style={{ gap: 'var(--space-4)' }}>
      {info.sections.map((section, i) => (
        <div key={i} className="block" style={{ gap: 6 }}>
          <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
            <Eyebrow>{section.label}</Eyebrow>
            <span className="caption">{section.content.length} characters</span>
          </span>
          <pre style={mono}>{section.content || '(empty)'}</pre>
          <Rule end={50 + ((i * 11) % 34)} />
        </div>
      ))}
      <div className="block" style={{ gap: 6 }}>
        <span style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
          <Eyebrow>Final payload messages</Eyebrow>
          <span className="caption">{info.messages.length} messages</span>
        </span>
        <pre style={{ ...mono, fontSize: '0.68rem' }}>{JSON.stringify(info.messages, null, 2)}</pre>
      </div>
    </div>
  )
}

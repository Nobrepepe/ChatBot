import { useNavigate } from 'react-router-dom'
import type { World } from '@shared/types'
import { Eyebrow, Rule, TextAction } from '../../components/primitives'
import { Confirm, useOverlay } from '../../components/overlay'
import { useIpcMutation, useIpcQuery } from '../../lib/queries'
import { summaryLine } from '../../lib/summaryLine'

function relative(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export default function SessionsTab({ world }: { world: World }): React.JSX.Element {
  const navigate = useNavigate()
  const overlay = useOverlay()
  const scenes = useIpcQuery('scenes:list', world.id)
  const characters = useIpcQuery('characters:list', world.id)
  const templatesQuery = useIpcQuery('templates:list', world.id)
  const deleteScene = useIpcMutation('scenes:delete', ['scenes:list', 'scenes:listAll'])
  const deleteTemplate = useIpcMutation('templates:delete', ['templates:list'])

  const nameById = new Map((characters.data ?? []).map((c) => [c.id, c.name]))
  const list = scenes.data ?? []
  const templates = templatesQuery.data ?? []

  return (
    <div className="block" style={{ maxWidth: 760 }}>
      <TextAction size={30} onClick={() => navigate(`/world/${world.id}/scene/new`)}>
        Start a new scene →
      </TextAction>

      {list.map((scene) => (
        <div key={scene.id}>
          <div className="row-line">
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="row-title">{scene.title || 'Untitled scene'}</span>
              <span className="caption">
                {scene.characterIds.map((id) => nameById.get(id) ?? '?').join(', ') || 'No cast'} ·{' '}
                {relative(scene.updatedAt || scene.createdAt)}
              </span>
              {scene.summary.trim() ? (
                <span className="caption" style={{ color: 'var(--muted-2)' }}>
                  {summaryLine(scene.summary, 150)}
                </span>
              ) : null}
            </span>
            <TextAction kind="secondary" onClick={() => navigate(`/chat/${scene.id}`)}>
              Open scene →
            </TextAction>
            <TextAction
              kind="destructive"
              onClick={() =>
                overlay.open({
                  eyebrow: 'Confirm',
                  title: 'Delete this scene?',
                  render: (close) => (
                    <Confirm
                      body="Its transcript will be removed. Character memories remain."
                      actionLabel="Delete the scene"
                      close={close}
                      onConfirm={() => deleteScene.mutate([scene.id])}
                    />
                  )
                })
              }
            >
              Delete
            </TextAction>
          </div>
          <Rule end={54 + ((scene.id * 13) % 30)} />
        </div>
      ))}
      {list.length === 0 && scenes.isSuccess ? (
        <p className="body-text">Nothing has been played here yet.</p>
      ) : null}

      {templates.length > 0 ? (
        <>
          <div style={{ paddingTop: 'var(--space-4)' }}>
            <Eyebrow>Saved setups</Eyebrow>
          </div>
          {templates.map((t) => (
            <div key={t.id}>
              <div className="row-line">
                <span style={{ flex: 1 }} className="row-title">
                  {t.name}
                </span>
                <TextAction kind="secondary" onClick={() => navigate(`/world/${world.id}/scene/new/${t.id}`)}>
                  Use setup →
                </TextAction>
                <TextAction
                  kind="destructive"
                  onClick={() =>
                    overlay.open({
                      eyebrow: 'Confirm',
                      title: `Delete the setup “${t.name}”?`,
                      render: (close) => (
                        <Confirm
                          body="Scenes already started from it are not affected."
                          actionLabel="Delete the setup"
                          close={close}
                          onConfirm={() => deleteTemplate.mutate([t.id])}
                        />
                      )
                    })
                  }
                >
                  Delete
                </TextAction>
              </div>
              <Rule end={60 + ((t.id * 7) % 24)} />
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

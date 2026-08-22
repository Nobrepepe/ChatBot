import { useNavigate } from 'react-router-dom'
import { Screen } from '../components/Screen'
import { Eyebrow, FadingBar, HeroNumeral, Rule, TextAction } from '../components/primitives'
import { Art, ArtPlaceholder } from '../components/art'
import { useIpcQuery } from '../lib/queries'

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (Number.isNaN(days) || days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export default function HomeScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const worlds = useIpcQuery('worlds:list')
  const scenes = useIpcQuery('scenes:listAll')
  const settings = useIpcQuery('settings:get')

  const list = worlds.data ?? []
  const latest = (scenes.data ?? [])[0]
  const latestWorld = latest ? list.find((w) => w.id === latest.worldId) : undefined
  const messageCount = useIpcQuery('messages:count', latest?.id ?? -1)

  const historyLimit = Math.max(1, Number(settings.data?.historyLimit ?? 30) || 30)
  const total = latest ? (messageCount.data ?? 0) : 0
  const sent = Math.min(total, historyLimit)
  const outside = total - sent

  const backdropWorld = latestWorld?.coverImagePath ? latestWorld : list.find((w) => w.coverImagePath)

  return (
    <Screen
      rightActions={
        <>
          <TextAction kind="secondary" onClick={() => navigate('/personas')}>
            Personas
          </TextAction>
          <TextAction kind="secondary" onClick={() => navigate('/settings')}>
            Settings
          </TextAction>
        </>
      }
      backdrop={
        backdropWorld ? (
          <Art
            path={backdropWorld.coverImagePath}
            treatment="masked"
            style={{ position: 'absolute', right: '-14%', top: '-18%', width: '72%', opacity: 0.5 }}
          />
        ) : null
      }
    >
      {latest && latestWorld ? (
        <>
          <h1 className="display" style={{ maxWidth: '15em' }}>
            {latestWorld.name} is still mid-scene.
          </h1>
          <p className="body-text" style={{ maxWidth: 520 }}>
            {latest.title || 'An untitled scene'}, last touched{' '}
            {relativeDate(latest.updatedAt || latest.createdAt)}.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <HeroNumeral value={total} label="messages in this scene" />
            <div className="block" style={{ gap: 6, minWidth: 260 }}>
              <FadingBar fill={total ? sent / total : 0} width={260} />
              <span className="caption">
                {outside > 0
                  ? `The history window carries the last ${sent}. ${outside} now fall outside it — summarize the scene and they return as one remembered line.`
                  : `The history window carries all ${total} messages.`}
              </span>
            </div>
          </div>
          <TextAction
            onClick={() => navigate(`/chat/${latest.id}`)}
            sub={`${latest.mode} · ${latest.summary ? 'summarized' : 'nothing summarized yet'}`}
          >
            Return to {latest.title || 'the scene'} →
          </TextAction>
        </>
      ) : (
        <h1 className="display" style={{ maxWidth: '15em' }}>
          {list.length === 0
            ? 'Nothing started yet — make a world and it will wait for you here.'
            : `${list[0]!.name} is waiting for its first scene.`}
        </h1>
      )}

      <section className="block" style={{ maxWidth: 720, paddingTop: 'var(--space-4)' }}>
        <Eyebrow>Your worlds</Eyebrow>
        <Rule end={62} />
        {list.map((world) => (
          <div key={world.id}>
            <button type="button" className="row-line" onClick={() => navigate(`/world/${world.id}`)}>
              {world.coverImagePath ? (
                <Art
                  path={world.coverImagePath}
                  treatment="masked"
                  style={{ width: 118, aspectRatio: '16/9', objectFit: 'cover' }}
                />
              ) : (
                <ArtPlaceholder label="NO ART" aspect="16/9" style={{ width: 118 }} />
              )}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="row-title">{world.name}</span>
                <span className="caption">{world.genre || 'No genre yet'}</span>
              </span>
            </button>
            <Rule end={55 + ((world.id * 7) % 30)} />
          </div>
        ))}
        {list.length === 0 && worlds.isSuccess ? (
          <p className="body-text">No worlds yet. A world holds its characters, scenes and lore.</p>
        ) : null}
        <div style={{ paddingTop: 'var(--space-3)' }}>
          <TextAction onClick={() => navigate('/world/new')} sub="A world holds characters, scenes and lore.">
            Make a world →
          </TextAction>
        </div>
      </section>
    </Screen>
  )
}

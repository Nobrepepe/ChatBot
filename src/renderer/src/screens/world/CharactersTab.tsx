import { useNavigate } from 'react-router-dom'
import type { World } from '@shared/types'
import { TextAction } from '../../components/primitives'
import { Art, ArtPlaceholder } from '../../components/art'
import { useIpcQuery } from '../../lib/queries'

export default function CharactersTab({ world }: { world: World }): React.JSX.Element {
  const navigate = useNavigate()
  const characters = useIpcQuery('characters:list', world.id)
  const list = characters.data ?? []

  return (
    <div className="block" style={{ gap: 'var(--space-4)' }}>
      {!world.hubId ? (
        <TextAction onClick={() => navigate(`/world/${world.id}/character/new`)}>
          New character →
        </TextAction>
      ) : null}

      {list.length === 0 && characters.isSuccess ? (
        <p className="body-text" style={{ maxWidth: 480 }}>
          No one lives here yet. A character&apos;s profile becomes the voice the model follows.
        </p>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(236px, 1fr))',
          gap: 'var(--space-4)'
        }}
      >
        {list.map((c) => {
          const empty = !c.summary && !c.personality
          const art = c.tileImagePath || c.portraitPath
          return (
            <button
              key={c.id}
              type="button"
              className="row-line"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
              onClick={() => navigate(`/world/${world.id}/character/${c.id}`)}
              title={`Open ${c.name}`}
            >
              {art ? (
                <Art
                  path={art}
                  treatment="alpha"
                  ghost={empty}
                  style={{ width: '100%', aspectRatio: '16/9', objectFit: 'contain' }}
                />
              ) : (
                <ArtPlaceholder label="NO PORTRAIT" aspect="16/9" />
              )}
              <span className="row-title">{c.name}</span>
              <span className="caption">{empty ? 'Profile empty' : c.role || ' '}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

import { useNavigate, useParams } from 'react-router-dom'
import { TextAction, TextTabs } from '../../components/primitives'
import { Art } from '../../components/art'
import { Screen } from '../../components/Screen'
import { useIpcQuery } from '../../lib/queries'
import WorldDetailsTab from './WorldDetailsTab'
import CharactersTab from './CharactersTab'
import LorebookTab from './LorebookTab'
import SessionsTab from './SessionsTab'
import NotesListTab from '../notes/NotesListTab'

const TABS = ['World', 'Characters', 'Sessions', 'Lorebook', 'Notes'] as const
type Tab = (typeof TABS)[number]

const TAB_TO_ROUTE: Record<Tab, string> = {
  World: '',
  Characters: 'characters',
  Sessions: 'sessions',
  Lorebook: 'lorebook',
  Notes: 'notes-list'
}
const ROUTE_TO_TAB: Record<string, Tab> = {
  characters: 'Characters',
  sessions: 'Sessions',
  lorebook: 'Lorebook',
  'notes-list': 'Notes'
}

export default function WorldScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const params = useParams<{ wid?: string; tab?: string }>()
  const worldId = params.wid ? Number(params.wid) : null
  const tab: Tab = (params.tab && ROUTE_TO_TAB[params.tab]) || 'World'

  const worldQuery = useIpcQuery('worlds:get', worldId ?? -1)
  const world = worldId ? (worldQuery.data ?? null) : null
  const isNew = worldId === null

  function selectTab(next: Tab): void {
    if (!worldId) return
    const segment = TAB_TO_ROUTE[next]
    navigate(segment ? `/world/${worldId}/${segment}` : `/world/${worldId}`)
  }

  return (
    <Screen
      back={{ label: 'Worlds', to: '/' }}
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
        world?.coverImagePath ? (
          <Art
            path={world.coverImagePath}
            treatment="masked"
            style={{ position: 'absolute', right: '-10%', top: '-12%', width: '62%', opacity: 0.28 }}
          />
        ) : null
      }
    >
      <h1
        className="display"
        style={{ fontSize: 'var(--size-display-xl)', maxWidth: '10em', lineHeight: 1 }}
      >
        {isNew ? 'A new world.' : (world?.name ?? '…')}
      </h1>

      {!isNew && world ? <TextTabs items={TABS} selected={tab} onSelect={selectTab} /> : null}

      {tab === 'World' || isNew ? <WorldDetailsTab world={world} /> : null}
      {tab === 'Characters' && world ? <CharactersTab world={world} /> : null}
      {tab === 'Lorebook' && world ? <LorebookTab world={world} /> : null}
      {tab === 'Sessions' && world ? <SessionsTab world={world} /> : null}
      {tab === 'Notes' && world ? <NotesListTab world={world} /> : null}
    </Screen>
  )
}

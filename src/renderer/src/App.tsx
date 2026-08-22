import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { useEffect } from 'react'
import { OverlayProvider } from './components/overlay'
import { SnackProvider } from './components/snack'
import { call } from './lib/api'
import HomeScreen from './screens/HomeScreen'
import WorldScreen from './screens/world/WorldScreen'
import CharacterEditorScreen from './screens/character/CharacterEditorScreen'
import PersonasScreen from './screens/PersonasScreen'
import SettingsScreen from './screens/settings/SettingsScreen'
import SceneSetupScreen from './screens/scene/SceneSetupScreen'
import ChatScreen from './screens/chat/ChatScreen'
import MemoriesScreen from './screens/character/MemoriesScreen'
import NotesWorkspaceScreen from './screens/notes/NotesWorkspaceScreen'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 5_000 }
  }
})

const router = createHashRouter([
  { path: '/', element: <HomeScreen /> },
  { path: '/settings', element: <SettingsScreen /> },
  { path: '/personas', element: <PersonasScreen /> },
  { path: '/world/new', element: <WorldScreen /> },
  { path: '/world/:wid', element: <WorldScreen /> },
  { path: '/world/:wid/:tab', element: <WorldScreen /> },
  { path: '/world/:wid/character/new', element: <CharacterEditorScreen /> },
  { path: '/world/:wid/character/:cid', element: <CharacterEditorScreen /> },
  { path: '/world/:wid/character/:cid/memories', element: <MemoriesScreen /> },
  { path: '/world/:wid/notes', element: <NotesWorkspaceScreen /> },
  { path: '/world/:wid/scene/new', element: <SceneSetupScreen /> },
  { path: '/world/:wid/scene/new/:templateId', element: <SceneSetupScreen /> },
  { path: '/chat/:sceneId', element: <ChatScreen /> }
])

/** Applies reduce-motion and text-scale settings to the document root. */
function useAccessibilitySettings(): void {
  useEffect(() => {
    call('settings:get').then((s) => {
      applyAccessibility(s.reduceMotion === '1', Number(s.textScale) || 1)
    })
  }, [])
}

export function applyAccessibility(reduceMotion: boolean, textScale: number): void {
  const root = document.documentElement
  if (reduceMotion) root.setAttribute('data-reduce-motion', '')
  else root.removeAttribute('data-reduce-motion')
  root.style.setProperty('--text-scale', String(Math.min(1.4, Math.max(1, textScale))))
}

export default function App(): React.JSX.Element {
  useAccessibilitySettings()
  return (
    <QueryClientProvider client={queryClient}>
      <SnackProvider>
        <OverlayProvider>
          <RouterProvider router={router} />
        </OverlayProvider>
      </SnackProvider>
    </QueryClientProvider>
  )
}

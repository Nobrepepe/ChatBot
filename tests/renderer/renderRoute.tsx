import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { render, type RenderResult } from '@testing-library/react'
import { routes } from '@renderer/App'
import { OverlayProvider } from '@renderer/components/overlay'
import { SnackProvider } from '@renderer/components/snack'

export interface RenderedRoute extends RenderResult {
  /** Current pathname, for asserting navigation. */
  path: () => string
}

/**
 * Mounts a screen through the app's real route table and providers, so tests
 * cover routing, data loading and overlays the same way the app does.
 */
export function renderRoute(initial: string): RenderedRoute {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } }
  })
  const router = createMemoryRouter(routes, { initialEntries: [initial] })
  const result = render(
    <QueryClientProvider client={client}>
      <SnackProvider>
        <OverlayProvider>
          <RouterProvider router={router} />
        </OverlayProvider>
      </SnackProvider>
    </QueryClientProvider>
  )
  return { ...result, path: () => router.state.location.pathname }
}

/** The <img> inside a labelled tile/row button, for checking art treatment. */
export function artInside(element: HTMLElement): HTMLImageElement | null {
  return element.querySelector('img')
}

/**
 * Window geometry is remembered between runs, so it can be restored onto a
 * machine whose displays have changed since it was saved — a laptop undocked
 * from an external monitor being the common case. Coordinates that no longer
 * land on a connected display would open the window where nobody can see it,
 * and an app with an invisible window looks like an app that died. Every
 * restore is therefore re-checked against the displays that exist right now.
 *
 * Kept free of the electron module so the placement rules can be unit tested.
 */

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

/** A display's usable area, in the same coordinate space as window bounds. */
export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_WIDTH = 960
export const MIN_HEIGHT = 640

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 820 }

// A window is only reachable if a grabbable strip of it — title bar included —
// sits inside a work area. Anything less and the user cannot drag it back.
const REACHABLE_WIDTH = 120
const REACHABLE_HEIGHT = 60

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** Parses saved JSON, returning null for anything that is not usable geometry. */
export function parseWindowState(raw: string): WindowState | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { width, height, x, y } = value as Record<string, unknown>
  if (!isNumber(width) || !isNumber(height)) return null
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null
  const state: WindowState = { width, height }
  if (isNumber(x) && isNumber(y)) {
    state.x = x
    state.y = y
  }
  return state
}

function overlap(state: Required<WindowState>, area: WorkArea): { width: number; height: number } {
  return {
    width: Math.max(
      0,
      Math.min(state.x + state.width, area.x + area.width) - Math.max(state.x, area.x)
    ),
    height: Math.max(
      0,
      Math.min(state.y + state.height, area.y + area.height) - Math.max(state.y, area.y)
    )
  }
}

/** The display showing most of the window, or null when it is on none of them. */
function hostDisplay(state: Required<WindowState>, areas: WorkArea[]): WorkArea | null {
  let best: WorkArea | null = null
  let bestArea = 0
  for (const area of areas) {
    const seen = overlap(state, area)
    const covered = seen.width * seen.height
    if (covered > bestArea) {
      best = area
      bestArea = covered
    }
  }
  return best
}

function centered(width: number, height: number, area: WorkArea): WindowState {
  return {
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2)
  }
}

/**
 * Fits a remembered state to the displays currently attached. The saved
 * position survives only when the window would still be visible and grabbable
 * on the display it was left on; otherwise it comes back centred on the primary
 * display, sized to fit. `areas[0]` must be the primary display's work area.
 */
export function placeWindow(state: WindowState, areas: WorkArea[]): WindowState {
  const primary = areas[0]
  if (!primary) return { width: state.width, height: state.height }

  const positioned = state.x !== undefined && state.y !== undefined
  const host = positioned
    ? (hostDisplay(state as Required<WindowState>, areas) ?? primary)
    : primary

  const width = Math.max(MIN_WIDTH, Math.min(state.width, host.width))
  const height = Math.max(MIN_HEIGHT, Math.min(state.height, host.height))

  // A window that no longer fits its old display has no meaningful position on
  // the new one either, so it is re-centred rather than pinned to a stale corner.
  if (positioned && width === state.width && height === state.height) {
    const seen = overlap(state as Required<WindowState>, host)
    if (seen.width >= REACHABLE_WIDTH && seen.height >= REACHABLE_HEIGHT) {
      return { width, height, x: state.x, y: state.y }
    }
  }
  return centered(width, height, host)
}

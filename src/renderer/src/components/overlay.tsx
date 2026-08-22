import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { Eyebrow, Rule, TextAction } from './primitives'

/**
 * Full-frame overlays — a dialog is a screen, not a card. They stack; Escape
 * closes the topmost. Content is passed as a render function receiving close().
 */

export interface OverlaySpec {
  eyebrow?: string
  title: string
  render: (close: () => void) => ReactNode
}

interface OverlayContextValue {
  open: (spec: OverlaySpec) => void
  closeTop: () => void
}

const OverlayContext = createContext<OverlayContextValue | null>(null)

export function useOverlay(): OverlayContextValue {
  const ctx = useContext(OverlayContext)
  if (!ctx) throw new Error('useOverlay outside OverlayProvider')
  return ctx
}

let overlayKey = 0

export function OverlayProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [stack, setStack] = useState<(OverlaySpec & { key: number })[]>([])
  const stackRef = useRef(stack)
  stackRef.current = stack

  const open = useCallback((spec: OverlaySpec) => {
    setStack((s) => [...s, { ...spec, key: ++overlayKey }])
  }, [])

  const closeTop = useCallback(() => {
    setStack((s) => s.slice(0, -1))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && stackRef.current.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        closeTop()
      }
    }
    // Capture phase so overlay Escape wins over screen-level handlers.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeTop])

  const value = useMemo(() => ({ open, closeTop }), [open, closeTop])

  return (
    <OverlayContext.Provider value={value}>
      {children}
      {stack.map((spec, index) => (
        <div className="overlay-backdrop" key={spec.key} role="dialog" aria-label={spec.title}>
          <div className="overlay-frame">
            <Eyebrow>{spec.eyebrow ?? 'Character Chat'}</Eyebrow>
            <h2 className="display">{spec.title}</h2>
            <Rule end={62} />
            {index === stack.length - 1 ? spec.render(closeTop) : spec.render(closeTop)}
            <div className="overlay-actions">
              <TextAction kind="secondary" onClick={closeTop}>
                Close
              </TextAction>
            </div>
          </div>
        </div>
      ))}
    </OverlayContext.Provider>
  )
}

/** A ready-made confirmation overlay body. */
export function Confirm({
  body,
  actionLabel,
  onConfirm,
  close
}: {
  body: string
  actionLabel: string
  onConfirm: () => void
  close: () => void
}): React.JSX.Element {
  return (
    <div className="block">
      <p className="body-text">{body}</p>
      <div className="overlay-actions">
        <TextAction
          kind="destructive"
          onClick={() => {
            onConfirm()
            close()
          }}
        >
          {actionLabel}
        </TextAction>
      </div>
    </div>
  )
}

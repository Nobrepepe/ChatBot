import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eyebrow } from './primitives'

interface ScreenProps {
  back?: { label: string; to: string }
  rightActions?: ReactNode
  backdrop?: ReactNode
  /**
   * An optional rail down the right edge. The page reflows into the space that
   * is left rather than sliding under it, so a rail never covers what the
   * writer is reading; at narrow widths it takes the screen instead.
   */
  rail?: ReactNode
  /**
   * How the screen spends height. A `document` — the default, and every other
   * screen — grows and lets the window scroll it. A `conversation` fits the
   * window: the chrome and the composer hold still and the transcript between
   * them does the scrolling, because a composer that scrolls away from the
   * conversation it belongs to is not a composer.
   */
  layout?: 'document' | 'conversation'
  children: ReactNode
}

/** Shared page chrome: back link or wordmark, right text actions, backdrop. */
export function Screen({
  back,
  rightActions,
  backdrop,
  rail,
  layout = 'document',
  children
}: ScreenProps): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <div className="screen" data-rail={rail ? '' : undefined} data-layout={layout}>
      {backdrop ? <div className="backdrop">{backdrop}</div> : null}
      <header className="screen-top">
        {back ? (
          <button
            type="button"
            className="text-action text-action--secondary"
            onClick={() => navigate(back.to)}
          >
            ← {back.label}
          </button>
        ) : (
          <Eyebrow>Character Chat</Eyebrow>
        )}
        <nav className="screen-top-actions">{rightActions}</nav>
      </header>
      <div className="screen-body">{children}</div>
      {rail ? <aside className="rail">{rail}</aside> : null}
    </div>
  )
}

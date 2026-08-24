import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Keeps a transcript pinned to its newest line.
 *
 * The transcript is not its own scroll region — the screen is `min-height:
 * 100vh` and grows, so it is the document that scrolls. Both are handled here:
 * whichever of the two actually overflows gets moved.
 *
 * Entering a scene always lands on the last message. After that the view only
 * follows when the reader was already at the bottom, so a streaming reply never
 * yanks them out of something they were reading further up.
 */

/** How far from the bottom still counts as "reading the newest line". */
const NEAR_BOTTOM = 120

/** The element that scrolls the page; documentElement in standards mode. */
function pageElement(): HTMLElement | null {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function scrollable(element: HTMLElement | null): boolean {
  return !!element && element.scrollHeight - element.clientHeight > 1
}

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.clientHeight - element.scrollTop
}

export function useStickToBottom(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[],
  /** False while the scene is still loading, so entry is not counted early. */
  ready = true
): void {
  const enteredRef = useRef(false)

  useLayoutEffect(() => {
    if (!ready) return
    const entering = !enteredRef.current
    const element = ref.current
    const page = pageElement()

    const target = scrollable(element) ? element : scrollable(page) ? page : null
    if (!entering && target && distanceFromBottom(target) > NEAR_BOTTOM) return

    const toBottom = (): void => {
      const el = ref.current
      if (scrollable(el)) el!.scrollTop = el!.scrollHeight
      const doc = pageElement()
      if (scrollable(doc)) doc!.scrollTop = doc!.scrollHeight
    }

    toBottom()
    // Markdown and portraits settle a frame later and change the height; a
    // single follow-up catches that without fighting the user's own scrolling.
    const frame = requestAnimationFrame(toBottom)
    enteredRef.current = true
    return () => cancelAnimationFrame(frame)
  }, [ready, ...deps])
}

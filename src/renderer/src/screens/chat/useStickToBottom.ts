import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Keeps a transcript pinned to its newest line.
 *
 * A conversation screen fits the window, so the transcript is its own scroll
 * region and the document never moves; this only ever scrolls the element it is
 * given. When there is no element — the scene is still loading, or the visual
 * novel stage is showing the latest line and nothing else — there is nothing to
 * do.
 *
 * What is watched is the content, not the scroll region. A scroll container's
 * own box never changes as things arrive inside it, so watching the container
 * means guessing at when it is ready; watching the content means the first real
 * layout, the stylesheet landing, a portrait resolving late and a reply
 * streaming in are all the same event, and all of them simply pin again.
 *
 * The reader is in charge after that. Scrolling up stops the following, and
 * coming back within a line or two of the bottom resumes it, so a streaming
 * reply never yanks anyone out of something they were reading further up.
 */

/** How far from the bottom still counts as "reading the newest line". */
const NEAR_BOTTOM = 120

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight
}

export function useStickToBottom(
  /** The scroll region. */
  scroller: HTMLElement | null,
  /** The single child whose height is the transcript's height. */
  content: HTMLElement | null,
  /** False while the scene is still loading, so entry is not counted early. */
  ready = true
): void {
  const followingRef = useRef(true)

  // A new transcript is owed the newest line: coming back from the visual
  // novel, or re-entering the scene, starts at the bottom again.
  useLayoutEffect(() => {
    followingRef.current = true
  }, [scroller])

  // Whether to keep following is the reader's to decide, and they say it by
  // scrolling. Distance from the bottom is the question, not a moved scrollTop:
  // the browser shifts scrollTop by itself whenever content above reflows.
  useEffect(() => {
    if (!scroller) return
    const onScroll = (): void => {
      followingRef.current = distanceFromBottom(scroller) <= NEAR_BOTTOM
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [scroller])

  useLayoutEffect(() => {
    if (!ready || !scroller || !content) return
    const pin = (): void => {
      scroller.scrollTop = scroller.scrollHeight
    }
    pin()
    const observer = new ResizeObserver(() => {
      if (followingRef.current) pin()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [ready, scroller, content])
}

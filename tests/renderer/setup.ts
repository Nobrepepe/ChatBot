import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Testing Library only auto-cleans when vitest globals are enabled; this
// project keeps them off, so unmount between tests explicitly or the DOM
// accumulates and queries start matching several screens at once.
afterEach(cleanup)

// jsdom implements no layout, so scrolling APIs are simply absent. The chat and
// notes transcripts call scrollTo to stay pinned to the newest line, which would
// otherwise throw and take the whole screen down under test.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (): void => {}
}

// Also absent for want of layout: the transcript watches its content with a
// ResizeObserver so a portrait resolving late, or a reply still arriving,
// cannot leave the newest line off the bottom. Nothing resizes on its own here,
// so the stub records its callbacks and a test fires them at the point a
// browser's layout would have — see contentResized.
const liveObservers = new Set<() => void>()

class TestResizeObserver implements ResizeObserver {
  private readonly fire: () => void
  constructor(callback: ResizeObserverCallback) {
    this.fire = () => callback([], this)
  }
  observe(): void {
    liveObservers.add(this.fire)
  }
  unobserve(): void {
    liveObservers.delete(this.fire)
  }
  disconnect(): void {
    liveObservers.delete(this.fire)
  }
}

globalThis.ResizeObserver = TestResizeObserver

/** The observed content changed height, as it does when a turn is added. */
export function contentResized(): void {
  for (const fire of [...liveObservers]) fire()
}

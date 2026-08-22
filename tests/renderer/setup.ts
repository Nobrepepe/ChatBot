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

import { describe, it, expect, afterEach } from 'vitest'
import { installDragGuard } from '@renderer/lib/dragGuard'

let uninstall: (() => void) | null = null

afterEach(() => {
  uninstall?.()
  uninstall = null
  document.body.innerHTML = ''
})

/** Start a drag on an element and report whether the browser would allow it. */
function dragFrom(element: Element): boolean {
  const event = new Event('dragstart', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return !event.defaultPrevented
}

describe('dragging inside the app', () => {
  it('refuses to start on prose, which has nowhere to be dropped', () => {
    document.body.innerHTML = '<p class="body-text">The bell has not rung since the flood.</p>'
    uninstall = installDragGuard()
    expect(dragFrom(document.querySelector('p')!)).toBe(false)
  })

  it('still allows it inside the fields where dropping text means something', () => {
    document.body.innerHTML =
      '<textarea></textarea><input /><div contenteditable="true"><span>note</span></div>'
    uninstall = installDragGuard()
    expect(dragFrom(document.querySelector('textarea')!)).toBe(true)
    expect(dragFrom(document.querySelector('input')!)).toBe(true)
    // Started on a child of the editable region, which is where the pointer is.
    expect(dragFrom(document.querySelector('[contenteditable] span')!)).toBe(true)
  })

  it('stops guarding once it is taken off', () => {
    document.body.innerHTML = '<p>Prose.</p>'
    const remove = installDragGuard()
    remove()
    expect(dragFrom(document.querySelector('p')!)).toBe(true)
  })
})

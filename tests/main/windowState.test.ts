import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_STATE,
  MIN_HEIGHT,
  MIN_WIDTH,
  parseWindowState,
  placeWindow,
  type WorkArea
} from '@main/windowState'

// A 14" MacBook Pro (3024x1964 native, 1512x982 in points) with a 49" Dell
// U4919DW parked to its right — the arrangement that first broke this.
const laptop: WorkArea = { x: 0, y: 25, width: 1512, height: 957 }
const dell: WorkArea = { x: 1512, y: 0, width: 5120, height: 1440 }

describe('parseWindowState', () => {
  it('accepts saved bounds', () => {
    expect(parseWindowState('{"x":40,"y":60,"width":1280,"height":820}')).toEqual({
      x: 40,
      y: 60,
      width: 1280,
      height: 820
    })
  })

  it('rejects unreadable, undersized or non-numeric geometry', () => {
    expect(parseWindowState('not json')).toBeNull()
    expect(parseWindowState('null')).toBeNull()
    expect(parseWindowState('{"width":300,"height":200}')).toBeNull()
    expect(parseWindowState('{"width":null,"height":820}')).toBeNull()
  })

  it('keeps the size but drops a half-written position', () => {
    expect(parseWindowState('{"width":1280,"height":820,"x":40}')).toEqual({
      width: 1280,
      height: 820
    })
  })
})

describe('placeWindow', () => {
  it('keeps a position that is still on a connected display', () => {
    const state = { x: 2000, y: 200, width: 1280, height: 820 }
    expect(placeWindow(state, [laptop, dell])).toEqual(state)
  })

  it('recovers a window left on a monitor that is now unplugged', () => {
    const placed = placeWindow({ x: 2000, y: 200, width: 1280, height: 820 }, [laptop])
    expect(placed).toEqual({ width: 1280, height: 820, x: 116, y: 94 })
  })

  it('shrinks a window that was sized for the bigger monitor', () => {
    const placed = placeWindow({ x: 1512, y: 0, width: 5120, height: 1440 }, [laptop])
    expect(placed.width).toBe(laptop.width)
    expect(placed.height).toBe(laptop.height)
    expect(placed.x).toBe(laptop.x)
  })

  it('pulls back a window dragged nearly off the edge', () => {
    const placed = placeWindow({ x: 1450, y: 940, width: 1280, height: 820 }, [laptop])
    expect(placed.x).toBe(116)
    expect(placed.y).toBe(94)
  })

  it('leaves a window straddling two displays alone', () => {
    const state = { x: 1200, y: 100, width: 1280, height: 820 }
    expect(placeWindow(state, [laptop, dell])).toEqual(state)
  })

  it('centres the first-run default on the primary display', () => {
    expect(placeWindow(DEFAULT_WINDOW_STATE, [dell, laptop])).toEqual({
      width: 1280,
      height: 820,
      x: 3432,
      y: 310
    })
  })

  it('never restores below the window minimums', () => {
    const tiny: WorkArea = { x: 0, y: 0, width: 800, height: 600 }
    const placed = placeWindow({ x: 0, y: 0, width: 1280, height: 820 }, [tiny])
    expect(placed.width).toBe(MIN_WIDTH)
    expect(placed.height).toBe(MIN_HEIGHT)
  })

  it('falls back to the saved size when no display is reported', () => {
    expect(placeWindow({ x: 40, y: 60, width: 1280, height: 820 }, [])).toEqual({
      width: 1280,
      height: 820
    })
  })
})

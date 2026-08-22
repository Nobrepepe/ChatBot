import { describe, it, expect, afterEach } from 'vitest'
import { CancelledError } from '@main/providers/errors'
import { cancelSceneOneShot, resetOneShotsForTests, runSceneOneShot } from '@main/ipc/oneShot'

afterEach(() => resetOneShotsForTests())

/** Resolves once the signal aborts, so a test can stand in for a slow model. */
function untilAborted(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')))
    setTimeout(() => resolve('finished'), 50)
  })
}

describe('the scene one-shot slot', () => {
  it('hands the running generation a live signal and its answer back', async () => {
    const seen: AbortSignal[] = []
    const value = await runSceneOneShot(1, async (signal) => {
      seen.push(signal)
      return 'a summary'
    })
    expect(value).toBe('a summary')
    expect(seen[0]!.aborted).toBe(false)
  })

  it('cancels the in-flight generation instead of queueing a second one', async () => {
    const first = runSceneOneShot(1, untilAborted)
    const second = runSceneOneShot(1, async () => 'the newer one')

    await expect(first).rejects.toBeInstanceOf(CancelledError)
    await expect(second).resolves.toBe('the newer one')
  })

  it('leaves another scene alone', async () => {
    const other = runSceneOneShot(2, untilAborted)
    await runSceneOneShot(1, async () => 'scene one')
    cancelSceneOneShot(1)
    await expect(other).resolves.toBe('finished')
  })

  it('reports a stop as cancelled, not as a failure to show the user', async () => {
    const running = runSceneOneShot(1, untilAborted)
    cancelSceneOneShot(1)
    await expect(running).rejects.toBeInstanceOf(CancelledError)
    await expect(running).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('lets a real failure through untouched', async () => {
    const boom = new Error('API error 500')
    await expect(runSceneOneShot(1, async () => Promise.reject(boom))).rejects.toBe(boom)
  })

  it('frees the slot once a generation settles, so the next one runs clean', async () => {
    await runSceneOneShot(1, async () => 'first')
    const second = runSceneOneShot(1, untilAborted)
    await expect(second).resolves.toBe('finished')
  })

  it('stops nothing when the scene has no generation running', () => {
    expect(() => cancelSceneOneShot(99)).not.toThrow()
  })
})

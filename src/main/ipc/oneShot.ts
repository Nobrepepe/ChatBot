import { CancelledError } from '../providers/errors'

/**
 * The scene's one-shot generations — summary, impersonation, memory
 * suggestions — share a single slot per scene. Each one costs a full prompt,
 * and a local model server answers them one at a time, so a second request
 * would only queue up behind the first and burn the context twice over.
 * Starting one therefore cancels whatever was still running for that scene,
 * and Stop cancels it outright.
 */
const active = new Map<number, AbortController>()

export async function runSceneOneShot<T>(
  sceneId: number,
  run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  active.get(sceneId)?.abort()
  const controller = new AbortController()
  active.set(sceneId, controller)
  try {
    return await run(controller.signal)
  } catch (err) {
    // fetch rejects with a DOMException the renderer cannot recognize; give
    // every abort — ours or the user's — one stable code instead.
    if (controller.signal.aborted) throw new CancelledError()
    throw err
  } finally {
    if (active.get(sceneId) === controller) active.delete(sceneId)
  }
}

export function cancelSceneOneShot(sceneId: number): void {
  active.get(sceneId)?.abort()
}

/** Test hook: forget every slot so one case cannot leak into the next. */
export function resetOneShotsForTests(): void {
  active.clear()
}

/**
 * The automatic passes: a summary and a memory review that run themselves
 * every few replies, like an autosave.
 *
 * They run at the end of the turn that triggers them, before the stream is
 * reported done, so the send button cannot unlock while a second request is
 * still out — the user cannot accidentally stack a reply on top of a pass.
 * They go through the scene's one-shot slot, so Stop cancels them the same way
 * it cancels a summary the user asked for by hand.
 */

import * as messagesRepo from '../db/repo/messages'
import * as memoriesRepo from '../db/repo/memories'
import * as scenesRepo from '../db/repo/scenes'
import * as settingsRepo from '../db/repo/settings'
import { runSceneOneShot } from '../ipc/oneShot'
import * as chat from './chatService'

function due(enabled: string, everyRaw: string, lastAt: number, count: number): boolean {
  if (enabled !== '1') return false
  const every = Math.max(1, Math.trunc(Number(everyRaw) || 0) || 1)
  return count - lastAt >= every
}

export interface AutoTaskReport {
  summarized: boolean
  memoriesApproved: number
  /** Written in the app's voice; empty when nothing went wrong. */
  problems: string[]
}

/**
 * Runs whichever passes are due for this scene. Never throws: an automatic
 * pass that fails must not take the reply that just streamed down with it.
 */
export async function runAutoTasks(
  sceneId: number,
  emit: (status: string) => void
): Promise<AutoTaskReport> {
  const report: AutoTaskReport = { summarized: false, memoriesApproved: 0, problems: [] }
  const scene = scenesRepo.getScene(sceneId)
  if (!scene) return report
  const settings = settingsRepo.getSettings()
  const count = messagesRepo.countMessages(sceneId)

  if (due(settings.autoSummary, settings.autoSummaryEvery, scene.autoSummaryAt, count)) {
    emit('summarizing')
    try {
      await runSceneOneShot(sceneId, (signal) => chat.summarize(sceneId, signal))
      report.summarized = true
    } catch (err) {
      report.problems.push(`The automatic summary did not run: ${(err as Error).message}`)
    } finally {
      // Marked either way: a failing endpoint should cost one attempt per
      // interval, not one per message.
      scenesRepo.setAutoTaskMark(sceneId, 'summary', count)
    }
  }

  if (due(settings.autoMemories, settings.autoMemoriesEvery, scene.autoMemoriesAt, count)) {
    emit('reading the scene')
    try {
      const proposals = await runSceneOneShot(sceneId, (signal) =>
        chat.proposeMemories(sceneId, signal)
      )
      for (const proposal of proposals) {
        try {
          memoriesRepo.approveMemorySuggestion(
            proposal.id,
            proposal.proposedContent,
            proposal.memoryType
          )
          report.memoriesApproved += 1
        } catch {
          // The memory moved under us; the proposal stays pending for review.
        }
      }
    } catch (err) {
      report.problems.push(`The automatic memory pass did not run: ${(err as Error).message}`)
    } finally {
      scenesRepo.setAutoTaskMark(sceneId, 'memories', count)
    }
  }

  return report
}

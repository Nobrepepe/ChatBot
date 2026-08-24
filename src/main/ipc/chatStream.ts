import { BrowserWindow } from 'electron'
import { STREAM_CHANNEL, type ChatStartParams, type StreamEvent } from '@shared/ipc'
import * as chat from '../services/chatService'
import * as messagesRepo from '../db/repo/messages'
import { runAutoTasks } from '../services/autoTasks'
import { generateNotesReply } from '../services/notesWorkspace'

let nextRequestId = 1
const active = new Map<number, AbortController>()

function emit(event: StreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(STREAM_CHANNEL, event)
  }
}

/**
 * Starts a streamed generation. Returns a requestId immediately; chunks,
 * completion and errors arrive as stream events. Cancelling keeps the partial
 * text — stopping a reply mid-sentence should not throw the words away.
 */
export function startChatStream(params: ChatStartParams): number {
  const requestId = nextRequestId++
  const controller = new AbortController()
  active.set(requestId, controller)

  void (async () => {
    let received = ''
    let aborted = false
    try {
      if (params.kind === 'notesChat') {
        // The generator persists the reply and its proposals on completion.
        for await (const delta of generateNotesReply(
          params.worldId,
          params.userMessage ?? null,
          params.activeNoteId ?? null,
          controller.signal
        )) {
          emit({ requestId, type: 'chunk', delta })
        }
        emit({ requestId, type: 'done' })
      } else if (params.kind === 'reply') {
        if (params.userMessage?.trim()) {
          chat.addUserMessage(params.sceneId, params.userMessage.trim())
        }
        const buildResult = chat.build(params.sceneId, {
          responderId: params.responderId,
          respondToLatest: params.respondToLatest
        })
        try {
          for await (const delta of chat.streamReply(
            params.sceneId,
            { responderId: params.responderId, respondToLatest: params.respondToLatest },
            controller.signal
          )) {
            received += delta
            emit({ requestId, type: 'chunk', delta })
          }
        } catch (err) {
          if ((err as Error).name === 'AbortError') aborted = true
          else throw err
        }
        const text = received.trim()
        if (text) chat.saveReply(params.sceneId, text, buildResult)
        // The turn is not over until the automatic passes are: the renderer
        // keeps the composer locked until 'done' arrives.
        let trouble: string | undefined
        if (!aborted && text) {
          const report = await runAutoTasks(params.sceneId, (status) =>
            emit({ requestId, type: 'status', message: status })
          )
          trouble = report.problems[0]
        }
        emit({
          requestId,
          type: 'done',
          message: aborted ? 'stopped' : trouble
        })
      } else {
        try {
          for await (const delta of chat.streamContinuation(
            params.sceneId,
            params.messageId,
            params.partial,
            controller.signal
          )) {
            received += delta
            emit({ requestId, type: 'chunk', delta })
          }
        } catch (err) {
          if ((err as Error).name === 'AbortError') aborted = true
          else throw err
        }
        const continuation = received.replace(/\s+$/, '')
        if (continuation) {
          messagesRepo.updateMessage(params.messageId, params.partial + continuation)
        }
        emit({ requestId, type: 'done', message: aborted ? 'stopped' : undefined })
      }
    } catch (err) {
      emit({ requestId, type: 'error', message: (err as Error).message })
    } finally {
      active.delete(requestId)
    }
  })()

  return requestId
}

export function cancelChatStream(requestId: number): void {
  active.get(requestId)?.abort()
}

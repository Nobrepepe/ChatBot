import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatStartParams } from '@shared/ipc'
import { call } from '../../lib/api'

export interface ChatStreamState {
  /** null when idle; the raw accumulated wire text while streaming. */
  streamText: string | null
  /**
   * What the turn is still doing after the reply itself finished — an
   * automatic summary or memory pass. null when nothing is owed.
   */
  status: string | null
  busy: boolean
  start: (params: ChatStartParams) => Promise<void>
  cancel: () => void
}

/**
 * Owns one streaming generation at a time: accumulates chunks, exposes the
 * live wire text, and fires onDone/onError when the request settles.
 */
export function useChatStream(
  onDone: (trouble?: string) => void,
  onError: (message: string) => void
): ChatStreamState {
  const [streamText, setStreamText] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const requestIdRef = useRef<number | null>(null)
  const doneRef = useRef(onDone)
  const errorRef = useRef(onError)
  doneRef.current = onDone
  errorRef.current = onError

  useEffect(() => {
    const unsubscribe = window.api.onStreamEvent((event) => {
      if (event.requestId !== requestIdRef.current) return
      if (event.type === 'chunk') {
        setStreamText((text) => (text ?? '') + (event.delta ?? ''))
      } else if (event.type === 'status') {
        setStatus(event.message ?? null)
      } else if (event.type === 'done') {
        requestIdRef.current = null
        setStreamText(null)
        setStatus(null)
        doneRef.current(event.message === 'stopped' ? undefined : event.message)
      } else {
        requestIdRef.current = null
        setStreamText(null)
        setStatus(null)
        errorRef.current(event.message ?? 'Generation failed.')
      }
    })
    return unsubscribe
  }, [])

  const start = useCallback(async (params: ChatStartParams) => {
    if (requestIdRef.current !== null) return
    setStatus(null)
    setStreamText('')
    requestIdRef.current = await call('chat:start', params)
  }, [])

  const cancel = useCallback(() => {
    if (requestIdRef.current !== null) {
      void call('chat:cancel', requestIdRef.current)
    }
  }, [])

  // A turn that is running an automatic pass has no stream text left but is
  // still busy: the composer must stay locked until 'done'.
  return { streamText, status, busy: streamText !== null || status !== null, start, cancel }
}

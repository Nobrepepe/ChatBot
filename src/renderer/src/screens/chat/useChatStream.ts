import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatStartParams } from '@shared/ipc'
import { call } from '../../lib/api'

export interface ChatStreamState {
  /** null when idle; the raw accumulated wire text while streaming. */
  streamText: string | null
  busy: boolean
  start: (params: ChatStartParams) => Promise<void>
  cancel: () => void
}

/**
 * Owns one streaming generation at a time: accumulates chunks, exposes the
 * live wire text, and fires onDone/onError when the request settles.
 */
export function useChatStream(
  onDone: () => void,
  onError: (message: string) => void
): ChatStreamState {
  const [streamText, setStreamText] = useState<string | null>(null)
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
      } else if (event.type === 'done') {
        requestIdRef.current = null
        setStreamText(null)
        doneRef.current()
      } else {
        requestIdRef.current = null
        setStreamText(null)
        errorRef.current(event.message ?? 'Generation failed.')
      }
    })
    return unsubscribe
  }, [])

  const start = useCallback(async (params: ChatStartParams) => {
    if (requestIdRef.current !== null) return
    setStreamText('')
    requestIdRef.current = await call('chat:start', params)
  }, [])

  const cancel = useCallback(() => {
    if (requestIdRef.current !== null) {
      void call('chat:cancel', requestIdRef.current)
    }
  }, [])

  return { streamText, busy: streamText !== null, start, cancel }
}

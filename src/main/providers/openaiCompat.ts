import type { AppSettings } from '@shared/types'
import { ProviderError } from './errors'

// Any OpenAI-compatible endpoint: Ollama, LM Studio, llama.cpp server, KoboldCpp…
// Settings are read fresh by the caller for every request, so changes apply on
// the next message without restarting.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function baseUrl(settings: AppSettings): string {
  const url = settings.baseUrl.trim().replace(/\/+$/, '')
  if (!url) throw new ProviderError('Set a base URL in Settings first.')
  return url
}

function headers(settings: AppSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.apiKey.trim()) h['Authorization'] = `Bearer ${settings.apiKey.trim()}`
  return h
}

function payload(messages: ChatMessage[], settings: AppSettings, stream: boolean): string {
  const model = settings.model.trim()
  if (!model) throw new ProviderError('Choose a model in Settings first.')
  const temperature = Number(settings.temperature)
  const topP = Number(settings.topP)
  const maxTokens = Number(settings.maxTokens)
  if ([temperature, topP, maxTokens].some((n) => Number.isNaN(n))) {
    throw new ProviderError('Invalid model settings: temperature, top-p and max tokens must be numbers.')
  }
  const body: Record<string, unknown> = { model, messages, stream, temperature, top_p: topP }
  if (maxTokens > 0) body['max_tokens'] = Math.trunc(maxTokens)
  return JSON.stringify(body)
}

async function post(url: string, body: string, settings: AppSettings, signal?: AbortSignal): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', headers: headers(settings), body, signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    if ((err as Error).name === 'TimeoutError') {
      throw new ProviderError('The request to the model timed out.')
    }
    throw new ProviderError(`Could not connect to ${url}. Is your local model server running?`)
  }
  if (response.status >= 400) {
    const text = (await response.text().catch(() => '')).slice(0, 500)
    throw new ProviderError(`API error ${response.status}: ${text}`)
  }
  return response
}

/**
 * Splits an SSE byte stream into `data:` payloads. fetch chunks can split a
 * line anywhere, so partial lines are buffered until their newline arrives.
 */
export async function* sseDataLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) yield line.slice(5).trim()
      }
    }
    const tail = buffer.trim()
    if (tail.startsWith('data:')) yield tail.slice(5).trim()
  } finally {
    reader.releaseLock()
  }
}

/** Streams reply text deltas; honors the `streaming` setting. */
export async function* streamChat(
  messages: ChatMessage[],
  settings: AppSettings,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const url = `${baseUrl(settings)}/chat/completions`
  const streaming = settings.streaming === '1'
  const response = await post(url, payload(messages, settings, streaming), settings, signal)

  if (!streaming) {
    const data = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[]
    } | null
    const content = data?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content) yield content
    return
  }

  if (!response.body) throw new ProviderError('The server returned no response body.')
  for await (const data of sseDataLines(response.body)) {
    if (data === '[DONE]') break
    let parsed: { choices?: { delta?: { content?: string } }[] }
    try {
      parsed = JSON.parse(data)
    } catch {
      continue // malformed keep-alive or partial junk — skip, as the old app did
    }
    const delta = parsed.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta) yield delta
  }
}

export async function listModels(settings: AppSettings): Promise<string[]> {
  const url = `${baseUrl(settings)}/models`
  let response: Response
  try {
    response = await fetch(url, {
      headers: headers(settings),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw new ProviderError(`Could not connect to ${url}. Is your local model server running?`)
  }
  if (response.status >= 400) {
    const text = (await response.text().catch(() => '')).slice(0, 500)
    throw new ProviderError(`API error ${response.status}: ${text}`)
  }
  const data = (await response.json().catch(() => null)) as { data?: { id?: string }[] } | null
  return (data?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
}

export interface ConnectionTest {
  latencyMs: number
  models: string[]
}

/** Lists models and measures how long the endpoint took to answer. */
export async function testConnection(settings: AppSettings): Promise<ConnectionTest> {
  const started = performance.now()
  const models = await listModels(settings)
  return { latencyMs: Math.round(performance.now() - started), models }
}

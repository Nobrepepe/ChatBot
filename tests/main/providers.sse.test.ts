import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { streamChat, listModels, testConnection, sseDataLines } from '@main/providers/openaiCompat'
import { ProviderError } from '@main/providers/errors'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'

let server: http.Server
let base: string

/** Per-request behavior switched by the requested model name. */
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'alpha' }, { id: 'beta' }] }))
      return
    }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const model: string = body.model

    if (model === 'fail-500') {
      res.writeHead(500)
      res.end('boom')
      return
    }
    if (model === 'plain') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'complete reply' } }] }))
      return
    }
    // Streaming: deliberately split one SSE line across two TCP writes and
    // include a malformed line plus a keep-alive comment.
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n')
    const second = 'data: {"choices":[{"delta":{"content":"lo wor"}}]}\n\n'
    res.write(second.slice(0, 12))
    await new Promise((r) => setTimeout(r, 10))
    res.write(second.slice(12))
    res.write(': keep-alive\n\n')
    res.write('data: not-json\n\n')
    if (model === 'slow') await new Promise((r) => setTimeout(r, 300))
    res.write('data: {"choices":[{"delta":{"content":"ld"}}]}\n\n')
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, baseUrl: base, model: 'stream-model', ...overrides }
}

async function drain(gen: AsyncGenerator<string>): Promise<string> {
  let out = ''
  for await (const chunk of gen) out += chunk
  return out
}

describe('streamChat', () => {
  it('reassembles SSE lines split across chunks and skips malformed data', async () => {
    const text = await drain(streamChat([{ role: 'user', content: 'hi' }], settings()))
    expect(text).toBe('Hello world')
  })

  it('supports non-streaming completion replies', async () => {
    const text = await drain(
      streamChat([{ role: 'user', content: 'hi' }], settings({ model: 'plain', streaming: '0' }))
    )
    expect(text).toBe('complete reply')
  })

  it('surfaces HTTP errors as ProviderError with the body excerpt', async () => {
    await expect(
      drain(streamChat([{ role: 'user', content: 'hi' }], settings({ model: 'fail-500' })))
    ).rejects.toThrow(/API error 500: boom/)
  })

  it('rejects unreachable servers with a friendly message', async () => {
    await expect(
      drain(
        streamChat([{ role: 'user', content: 'hi' }], settings({ baseUrl: 'http://127.0.0.1:1/v1' }))
      )
    ).rejects.toThrow(/Is your local model server running/)
  })

  it('requires a model and a base URL', async () => {
    await expect(drain(streamChat([], settings({ model: '' })))).rejects.toThrow(ProviderError)
    await expect(drain(streamChat([], settings({ baseUrl: '' })))).rejects.toThrow(ProviderError)
  })

  it('validates numeric settings', async () => {
    await expect(drain(streamChat([], settings({ temperature: 'warm' })))).rejects.toThrow(
      /must be numbers/
    )
  })

  it('can be aborted mid-stream', async () => {
    const controller = new AbortController()
    const gen = streamChat([{ role: 'user', content: 'hi' }], settings({ model: 'slow' }), controller.signal)
    let received = ''
    await expect(
      (async () => {
        for await (const chunk of gen) {
          received += chunk
          if (received.includes('Hello wor')) controller.abort()
        }
      })()
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(received).toContain('Hello wor')
  })
})

describe('listModels / testConnection', () => {
  it('lists model ids', async () => {
    expect(await listModels(settings())).toEqual(['alpha', 'beta'])
  })

  it('measures latency', async () => {
    const result = await testConnection(settings())
    expect(result.models).toEqual(['alpha', 'beta'])
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.latencyMs).toBeLessThan(5000)
  })
})

describe('sseDataLines', () => {
  it('handles CRLF and a trailing unterminated data line', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode('data: one\r\n\r\ndata: tw'))
        controller.enqueue(enc.encode('o\n\ndata: three'))
        controller.close()
      }
    })
    const lines: string[] = []
    for await (const line of sseDataLines(stream)) lines.push(line)
    expect(lines).toEqual(['one', 'two', 'three'])
  })
})

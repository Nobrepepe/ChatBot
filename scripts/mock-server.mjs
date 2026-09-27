// Tiny mock OpenAI-compatible server for testing the app without a real model.
//
// Run with:  node scripts/mock-server.mjs [port]
// Then set the base URL in Settings to http://localhost:8111/v1
//
// It inspects the prompt to imitate real behavior:
// - custom sprite instruction -> reply starts with one of its configured call signs
// - labelled-turn rules       -> reply uses '{Name} "dialogue"' blocks
// - extra turn request        -> reply comes from someone who is not in the cast
// - summary request           -> returns a short summary
// - memory suggestions        -> returns a bullet list of facts

import http from 'node:http'

const REPLY =
  'She looks up slowly, rain still clinging to her hair. ' +
  '"I didn\'t think you\'d actually come looking for me," she says, ' +
  'half a smile breaking through despite herself.'

const SUMMARY = [
  '- The user came looking for the character on the rooftop.',
  '- The character was surprised but quietly pleased.',
  '- Tension eased by the end of the conversation.'
].join('\n')

/**
 * The memory pass answers with memory_action blocks. Ids have to come from the
 * prompt itself: a rewrite targets the first memory the prompt lists, and a
 * create targets the first character it names.
 */
function memoryActions(system) {
  const memoryId = system.match(/\[Memory id=(\d+)/)?.[1]
  const characterId = system.match(/character_id=(\d+)/)?.[1] ?? '1'
  const blocks = []
  if (memoryId) {
    blocks.push(
      '```memory_action\n' +
        JSON.stringify({
          type: 'replace',
          memory_id: Number(memoryId),
          memory_type: 'relationship',
          content: 'They are glad the user came looking for them.'
        }) +
        '\n```'
    )
  }
  blocks.push(
    '```memory_action\n' +
      JSON.stringify({
        type: 'create',
        character_id: Number(characterId),
        memory_type: 'canon',
        content: 'They admitted they were avoiding everyone on purpose.'
      }) +
      '\n```'
  )
  return 'Two things changed in this scene.\n\n' + blocks.join('\n\n')
}

const MULTI_LINES = ['"I heard something down there."', '"Then we go together."', '"Fine. But quietly."']

/**
 * The extra's turn is steered from the end of the prompt, not from the system
 * section, so this reads the last user turn. It reuses an extra the scene
 * already has when the instruction lists one, the way a real model is asked to.
 */
function extraReply(closing) {
  const known = closing.match(/Extras already in this scene: \{([^}]+)\}/)?.[1]
  const hint = closing.match(/\[The scene calls on: (.+?)\.\]/)?.[1]
  const name = known ?? (hint ? hint.replace(/^the /i, '') : 'Taxi driver')
  const label = name.charAt(0).toUpperCase() + name.slice(1)
  return `{${label}} "Where to, then?" *They glance back through the mirror, unbothered.*`
}

function composeReply(payload) {
  let system = ''
  for (const m of payload.messages ?? []) {
    if (m.role === 'system') system += m.content ?? ''
  }
  const closing = payload.messages?.at(-1)?.content ?? ''
  if (closing.includes('the reply comes from an extra')) return extraReply(closing)
  if (system.includes('Summarize the scene transcript')) return SUMMARY
  if (system.includes('maintaining the long-term memory')) return memoryActions(system)
  if (system.includes('helping the user roleplay as their persona')) {
    return '*I take a cautious step closer.* "Tell me what really happened."'
  }
  if (system.includes('worldbuilding and writing assistant')) {
    return (
      'The harbor could anchor your Setting notes — its tides explain both the ' +
      'festival calendar and the smugglers.\n\n' +
      '```note_action\n' +
      '{"type":"create","title":"The Harbor","category":"Setting",' +
      '"content":"Tides govern the festival calendar. Smugglers use the third pier.",' +
      '"context_mode":"relevant","is_pinned":false}\n' +
      '```'
    )
  }
  let reply = REPLY
  if (system.includes('More than one voice can speak')) {
    const names = [...system.matchAll(/Character profile: (\w+)/g)].map((m) => m[1])
    const cast = names.length ? names.slice(0, 3) : ['Ana', 'Bea']
    const parts = cast.map((n, i) => `{${n}} ${MULTI_LINES[i % MULTI_LINES.length]}`)
    if (system.includes('scene narrator')) {
      parts.splice(1, 0, '*A cold draft rolls through the corridor.*')
    }
    return parts.join('\n\n')
  }
  if (system.includes('scene narrator')) {
    reply = '*Rain taps against the old windows.*\n\n' + reply
  }
  if (system.includes('sprite call sign in square brackets')) {
    const choices = [...system.matchAll(/\[([^\][]+)\] \([^\r\n,]+\)/g)].map((m) => m[1])
    if (choices.length) {
      reply = `[${choices[Math.floor(Math.random() * choices.length)]}] ${reply}`
    }
  }
  return reply
}

const port = Number(process.argv[2] ?? 8111)

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '').replace(/\/+$/, '')
  if (req.method === 'GET' && path.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mock-model-7b' }, { id: 'mock-model-13b' }] }))
    return
  }
  if (req.method === 'POST' && path.endsWith('/chat/completions')) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let payload = {}
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    } catch {
      /* treat unparseable bodies as empty */
    }
    const reply = composeReply(payload)
    console.log(`[mock] POST ${path} stream=${!!payload.stream}`)
    if (payload.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const words = reply.split(' ')
      for (let i = 0; i < words.length; i++) {
        const content = words[i] + (i < words.length - 1 ? ' ' : '')
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
        await new Promise((r) => setTimeout(r, 30))
      }
      res.end('data: [DONE]\n\n')
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }))
    }
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock OpenAI-compatible server on http://localhost:${port}/v1`)
})

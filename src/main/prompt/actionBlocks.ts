/**
 * Portable action blocks — the shape the model uses to propose a concrete
 * change (a note edit, a memory edit) alongside its prose. One scanner serves
 * every kind: it finds the block, decodes it, and hands the payloads to a
 * caller-supplied validator. A block the validator rejects is left in the
 * visible text rather than swallowed, so a malformed proposal is something the
 * user can see and the model can be told about, never a silent no-op.
 */

function blockPattern(fenceTag: string, types: readonly string[]): RegExp {
  const typeAlternation = types.join('|')
  return new RegExp(
    [
      `\`\`\`${fenceTag}\\s*\\n(?<direct>[\\s\\S]*?)\\s*\\n\`\`\``,
      `\`${fenceTag}\`\\s*\\n?\\s*\`\`\`json\\s*\\n(?<labelled>[\\s\\S]*?)\\s*\\n\`\`\``,
      '```json\\s*\\n(?<generic>[\\s\\S]*?)\\s*\\n```',
      '(?:^|\\n)(?<bare>\\[\\s*\\{[\\s\\S]*\\}\\s*\\])\\s*$',
      `(?:^|\\n)(?<bareObject>\\{\\s*"type"\\s*:\\s*"(?:${typeAlternation})"[\\s\\S]*\\})\\s*$`
    ].join('|'),
    'gi'
  )
}

export interface ExtractOptions {
  /** The fence label the prompt asks for, e.g. 'note_action'. */
  fenceTag: string
  /** Action types this kind accepts; also used to spot a bare object. */
  types: readonly string[]
}

/**
 * `validate` receives every payload object in one block and returns the actions
 * it stands for, or throws to reject the block whole — a block is all or
 * nothing, because half-applying a batch is worse than showing it.
 */
export function extractActionBlocks<T>(
  text: string,
  options: ExtractOptions,
  validate: (payloads: Record<string, unknown>[]) => T[]
): { visibleText: string; actions: T[] } {
  const actions: T[] = []
  const parts: string[] = []
  let cursor = 0
  for (const match of text.matchAll(blockPattern(options.fenceTag, options.types))) {
    parts.push(text.slice(cursor, match.index))
    const groups = match.groups ?? {}
    const raw =
      groups['direct'] ?? groups['labelled'] ?? groups['generic'] ?? groups['bare'] ?? groups['bareObject']
    let consumed = false
    try {
      const decoded: unknown = JSON.parse(raw ?? '')
      const payloads = Array.isArray(decoded) ? decoded : [decoded]
      if (!payloads.length || !payloads.every((p) => p && typeof p === 'object' && !Array.isArray(p))) {
        throw new Error('invalid action payload')
      }
      actions.push(...validate(payloads as Record<string, unknown>[]))
      consumed = true
    } catch {
      /* fall through: keep the block visible */
    }
    if (!consumed) parts.push(match[0])
    cursor = match.index + match[0].length
  }
  parts.push(text.slice(cursor))
  return { visibleText: parts.join('').trim(), actions }
}

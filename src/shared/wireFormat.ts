/**
 * The wire format between the app and the model.
 *
 * Persistence is structured (messages carry character_id and a bare emotion
 * column); these tags exist only inside prompts and streamed replies:
 *   {Name}    — speaker label in multi-character scenes
 *   [emotion] — sprite call sign chosen by the reply
 */

const SPRITE_RE = /^\s*\[(?<emotion>[^\][\r\n]{1,64})\]\s*/
const SPEAKER_RE = /^\s*\{(?<name>[^{}\n]+)\}\s*/

/** Split a leading [emotion] tag off a reply. Returns bare lowercase emotion + rest. */
export function parseEmotion(
  text: string,
  callSigns?: readonly string[]
): { emotion: string; rest: string } {
  const m = SPRITE_RE.exec(text)
  if (m?.groups?.['emotion'] !== undefined) {
    const found = m.groups['emotion'].trim().toLowerCase()
    const allowed = callSigns ? new Set(callSigns.map((s) => s.toLowerCase())) : null
    if (!allowed || allowed.has(found)) {
      return { emotion: found, rest: text.slice(m[0].length) }
    }
  }
  return { emotion: '', rest: text }
}

/**
 * Detect a leading {Name} speaker tag. When `names` is given the tag must
 * match one of them (case-insensitively); the canonical name is returned.
 */
export function parseSpeakerPrefix(
  text: string,
  names?: readonly string[]
): { name: string; rest: string } | null {
  const m = SPEAKER_RE.exec(text)
  const found = m?.groups?.['name']?.trim()
  if (!m || !found) return null
  if (names) {
    const canonical = names.find((n) => n.toLowerCase() === found.toLowerCase())
    if (!canonical) return null
    return { name: canonical, rest: text.slice(m[0].length) }
  }
  return { name: found, rest: text.slice(m[0].length) }
}

/** Strip both wire tags for display, storage or export. */
export function stripWirePrefixes(
  text: string,
  names?: readonly string[],
  callSigns?: readonly string[]
): { speaker: string | null; emotion: string; content: string } {
  const speaker = parseSpeakerPrefix(text, names)
  const afterSpeaker = speaker ? speaker.rest : text
  const { emotion, rest } = parseEmotion(afterSpeaker, callSigns)
  return { speaker: speaker?.name ?? null, emotion, content: rest }
}

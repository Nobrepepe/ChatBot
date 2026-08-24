/**
 * Scene titles that run in a series. A scene continued from another is named
 * after its parent with a part number, and the numbers are roman because the
 * app reads as a book: "The rooftop - Part II", then "- Part III".
 */

const NUMERALS: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I']
]

const VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

/** 1..3999; anything outside that range comes back as plain digits. */
export function toRoman(value: number): string {
  const n = Math.trunc(value)
  if (!Number.isFinite(n) || n < 1 || n > 3999) return String(value)
  let left = n
  let out = ''
  for (const [amount, numeral] of NUMERALS) {
    while (left >= amount) {
      out += numeral
      left -= amount
    }
  }
  return out
}

/** null when the text is not a well-formed numeral. */
export function fromRoman(text: string): number | null {
  const raw = text.trim().toUpperCase()
  if (!/^[IVXLCDM]+$/.test(raw)) return null
  let total = 0
  for (let i = 0; i < raw.length; i += 1) {
    const value = VALUES[raw[i]!]!
    const next = i + 1 < raw.length ? VALUES[raw[i + 1]!]! : 0
    total += value < next ? -value : value
  }
  // Round-tripping rejects IIII, IC and friends without a second grammar.
  return toRoman(total) === raw ? total : null
}

const PART = /^(.*?)[\s]*[-–—][\s]*Part[\s]+([IVXLCDM]+|\d+)[\s]*$/i

/**
 * The next title in the series. A title that is not already a part becomes
 * Part II, since the original scene is part one. An arabic part number typed
 * by hand is understood, but the answer is always roman.
 */
export function nextInSeries(title: string): string {
  const trimmed = (title ?? '').trim()
  const match = PART.exec(trimmed)
  if (match) {
    const base = match[1]!.trim()
    const current = fromRoman(match[2]!) ?? Number(match[2])
    if (base && Number.isFinite(current) && current >= 1) {
      return `${base} - Part ${toRoman(current + 1)}`
    }
  }
  const base = trimmed || 'Untitled scene'
  return `${base} - Part ${toRoman(2)}`
}

/**
 * A scene summary is written as a short bullet list. Where a list would be
 * heavier than the thing it describes — under a home-screen headline, beside a
 * scene in a list — it reads as one line instead: bullets dropped, points
 * separated by a middot, and cut with an ellipsis rather than mid-word.
 */
export function summaryLine(summary: string, limit = 220): string {
  const flat = summary
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .join(' · ')
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit).replace(/\s+\S*$/, '')}…`
}

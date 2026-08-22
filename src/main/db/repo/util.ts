/** Shared row helpers for the repositories. */

export const now = (): string => new Date().toISOString()

export const toBool = (v: unknown): boolean => v === 1 || v === true

export function parseJsonArray(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** Guard: hub-managed rows may never be mutated by app-side editing. */
export function assertNotHubManaged(row: { hub_id?: unknown } | undefined, what: string): void {
  if (row && row.hub_id) {
    throw new Error(`This ${what} comes from a World Hub publication and is read-only here.`)
  }
}

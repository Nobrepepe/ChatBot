import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// All data-directory access goes through here so tests (and portable installs)
// can redirect everything with CHATBOT_DATA_DIR before the first call.

let cachedRoot: string | null = null

export function dataRoot(): string {
  if (cachedRoot) return cachedRoot
  const override = process.env['CHATBOT_DATA_DIR']
  if (override) {
    cachedRoot = override
  } else {
    // Imported lazily so unit tests never need the electron module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    cachedRoot = app.getPath('userData')
  }
  mkdirSync(cachedRoot, { recursive: true })
  return cachedRoot
}

/** Test hook: forget the cached root so a new CHATBOT_DATA_DIR takes effect. */
export function resetDataRootForTests(): void {
  cachedRoot = null
}

function ensured(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

export const dbPath = (): string => join(ensured(join(dataRoot(), 'data')), 'chatbot.db')
export const exportsDir = (): string => join(dataRoot(), 'data', 'exports')
export const worldhubContentDir = (): string => join(dataRoot(), 'data', 'worldhub-content')
export const mediaRoot = (): string => ensured(join(dataRoot(), 'media'))

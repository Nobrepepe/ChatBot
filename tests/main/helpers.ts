import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetDataRootForTests } from '@main/paths'
import { closeDbForTests } from '@main/db/connection'

/** Point the whole app at a fresh temp data dir; returns a cleanup function. */
export function useTempDataDir(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'chatbot-test-'))
  process.env['CHATBOT_DATA_DIR'] = dir
  resetDataRootForTests()
  return () => {
    closeDbForTests()
    delete process.env['CHATBOT_DATA_DIR']
    resetDataRootForTests()
    rmSync(dir, { recursive: true, force: true })
  }
}

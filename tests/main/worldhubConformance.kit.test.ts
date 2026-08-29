import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * World Hub conformance.
 *
 * The kit ships a checker; running it here makes the standard something the
 * build enforces rather than something a document asks anyone to remember. It
 * covers the contract's vocabulary, recipe names written into code,
 * compatibility gating, whether the conformance fixtures have gone stale, and
 * the two install-time traps that are invisible until they fire.
 *
 * A failure names the file, the line, and the fix. The reasoning is in
 * vendor/worldhub-kit/CONSUMER_GUIDE.md.
 */

const APP_ROOT = join(__dirname, '..', '..')
const VERIFY = join(APP_ROOT, 'vendor', 'worldhub-kit', 'js', 'verify.mjs')

describe('World Hub conformance', () => {
  it('passes the kit’s checks', () => {
    expect(existsSync(VERIFY), 'vendor/worldhub-kit is missing — run `node scripts/kit-sync.mjs chatbot` from World Hub').toBe(true)
    let output = ''
    try {
      output = execFileSync('node', [VERIFY, '--app-root', APP_ROOT], { encoding: 'utf8' })
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string }
      throw new Error(`\n${failure.stdout ?? ''}${failure.stderr ?? ''}`)
    }
    expect(output).toContain('passes')
  })
})

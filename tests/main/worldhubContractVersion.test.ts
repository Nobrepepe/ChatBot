import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractZipSafely, loadPackage, PackageError } from '@main/worldhub/packageReader'
import { APP_TYPE } from '@main/worldhub/consumerService'

/**
 * A package carries two different numbers called "version":
 *
 *   manifest.contract.version   the Hub's revision of the contract record,
 *                               bumped every time the author edits it
 *   contract.contractVersion    the contract format version, which is what
 *                               decides whether this app can read the package
 *
 * Only the second one may gate compatibility. Conflating them rejected a
 * perfectly readable publication the moment the contract was edited.
 */

const FIXTURE = join(__dirname, '..', 'fixtures', 'worldhub', 'valid-v1.zip')
let dir: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'contract-version-'))
  await extractZipSafely(FIXTURE, dir)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** Rewrite a package file and keep its checksum entry honest. */
function patchJson(relativePath: string, mutate: (json: any) => void): void {
  const full = join(dir, ...relativePath.split('/'))
  const json = JSON.parse(readFileSync(full, 'utf8'))
  mutate(json)
  const text = JSON.stringify(json, null, 2)
  writeFileSync(full, text)

  const checksumsPath = join(dir, 'checksums.json')
  const checksums = JSON.parse(readFileSync(checksumsPath, 'utf8')) as Record<string, string>
  checksums[relativePath] = createHash('sha256').update(readFileSync(full)).digest('hex')
  writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2))
}

describe('contract version handling', () => {
  it('accepts a package whose contract record has been revised by the author', () => {
    patchJson('manifest.json', (m) => {
      m.contract.version = 2
    })
    const pkg = loadPackage(dir, APP_TYPE)
    expect(pkg.manifest['contract']['version']).toBe(2)
    expect(pkg.contract['contractVersion']).toBe(1)
  })

  it('keeps accepting it as the author keeps editing', () => {
    patchJson('manifest.json', (m) => {
      m.contract.version = 47
    })
    expect(() => loadPackage(dir, APP_TYPE)).not.toThrow()
  })

  it('still refuses a contract written in a newer format', () => {
    patchJson('production/contract.json', (c) => {
      c.contractVersion = 2
    })
    expect(() => loadPackage(dir, APP_TYPE)).toThrow(/contract format this app does not support/)
  })

  it('still refuses a newer package protocol', () => {
    patchJson('manifest.json', (m) => {
      m.protocolVersion = 2
    })
    expect(() => loadPackage(dir, APP_TYPE)).toThrow(/newer World Hub protocol/)
  })

  it('still refuses a package built for another app', () => {
    patchJson('manifest.json', (m) => {
      m.applicationType = 'some-other.app'
    })
    expect(() => loadPackage(dir, APP_TYPE)).toThrow(PackageError)
  })
})

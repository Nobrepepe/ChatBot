import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPackage, type PackageInfo } from '@worldhub-kit/js/package-reader.mjs'
import { extractZipSafely } from '@worldhub-kit/js/zip-reader.mjs'
import { APP_TYPE } from '@main/worldhub/consumerService'

/**
 * Art is resolved through the contract embedded in each package, never
 * through recipe names written here. World Hub renames recipes — it has
 * already done so once, retiring landscape_16x9, portrait_9x16 and the
 * square character tile — and this app should need no edit when it happens
 * again.
 */

const CONTRACT_PATH = join(__dirname, '..', '..', 'worldhub', 'application-contract.json')
const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
  requiredRecipes: string[]
  supportedProtocolVersions: number[]
  contractFormatVersion: number
  entitySelections: { id: string; assetSets: { id: string; roles: string[]; recipes: string[] }[] }[]
}

let dir: string
let pkg: PackageInfo

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'recipes-'))
  extractZipSafely(join(__dirname, '..', 'fixtures', 'worldhub', 'valid-v1.zip'), dir)
  pkg = loadPackage(dir, APP_TYPE)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('the published contract', () => {
  it('requires only the current recipe names', () => {
    expect(contract.requiredRecipes).toEqual(['tile_16x9', 'portrait_3x4'])
  })

  it('declares it can read the protocol World Hub publishes', () => {
    expect(contract.contractFormatVersion).toBe(1)
    expect(contract.supportedProtocolVersions).toContain(2)
  })

  it('uses the renamed character roles and recipes', () => {
    const cast = contract.entitySelections.find((s) => s.id === 'cast')!
    const tile = cast.assetSets.find((a) => a.id === 'tile')!
    const sprites = cast.assetSets.find((a) => a.id === 'sprites')!
    expect(tile.roles).toEqual(['character.tile'])
    expect(tile.recipes).toEqual(['tile_16x9'])
    expect(sprites.roles).toEqual(['character.portrait'])
    expect(sprites.recipes).toEqual(['portrait_3x4'])
  })

  it('has no retired vocabulary left anywhere', () => {
    const raw = readFileSync(CONTRACT_PATH, 'utf8')
    for (const retired of ['landscape_16x9', 'portrait_9x16', 'card_3x4', 'character.identity_tile', 'character.expression']) {
      expect(raw).not.toContain(retired)
    }
  })
})

describe('resolution goes through the package, not through names in this file', () => {
  it('reads each set’s recipes out of the package’s own contract', () => {
    expect(pkg.recipesFor('tile')).toEqual(['tile_16x9'])
    expect(pkg.recipesFor('sprites')).toEqual(['portrait_3x4'])
    expect(pkg.recipesFor('cb_world_cover')).toEqual(['tile_16x9'])
  })

  it('finds a set by what the art is for, so renaming a set strands nothing', () => {
    expect(pkg.setForRole('character.tile')).toBe('tile')
    expect(pkg.setForRole('character.portrait')).toBe('sprites')
    expect(pkg.setForRole('world.background')).toBe('session_background')
    expect(pkg.setForRole('nothing.here')).toBeNull()
  })

  it('resolves real art through the recipes the contract asked for', () => {
    const tileSet = pkg.setForRole('character.tile')!
    const entry = pkg.assetIndex.find((e) => e['setId'] === tileSet)!
    const chosen = pkg.assetFile(entry.assetId, pkg.recipesFor(tileSet))
    expect(chosen?.recipeId).toBe('tile_16x9')
    expect(chosen?.path).toBeTruthy()
  })

  it('falls back to any available rendition rather than losing the art', () => {
    const entry = pkg.assetIndex[0]!
    expect(pkg.assetFile(entry.assetId, ['no_such_recipe'])?.assetId).toBe(entry.assetId)
    expect(pkg.assetFile('no-such-asset', ['tile_16x9'])).toBeNull()
  })
})

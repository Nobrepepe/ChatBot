import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assetFile, type AssetIndexEntry, type PackageInfo } from '@main/worldhub/packageReader'

/**
 * The contract renamed its recipes (landscape_16x9 -> tile_16x9,
 * portrait_9x16 -> portrait_3x4, character tiles from square -> tile_16x9).
 * Publications packaged under the older contract stay readable, because
 * rollback and pinned conversations re-import them from the local cache.
 */

const contract = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'worldhub', 'application-contract.json'), 'utf8')
) as {
  requiredRecipes: string[]
  entitySelections: { id: string; assetSets: { id: string; roles: string[]; recipes: string[] }[] }[]
}

function pkg(entries: Partial<AssetIndexEntry>[]): PackageInfo {
  return {
    assetIndex: entries.map((e, i) => ({
      assetId: 'a1',
      versionId: `v${i}`,
      path: `assets/files/a1/${e.recipeId}.webp`,
      recipeId: 'unknown',
      ...e
    })) as AssetIndexEntry[]
  } as PackageInfo
}

const WIDE = ['tile_16x9', 'landscape_16x9']
const PORTRAIT = ['portrait_3x4', 'portrait_9x16']
const TILE = ['tile_16x9', 'square', 'thumbnail_square']

describe('the published contract', () => {
  it('requires only the current recipe names', () => {
    expect(contract.requiredRecipes).toEqual(['tile_16x9', 'portrait_3x4'])
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

  it('has no landscape_16x9 left anywhere', () => {
    const raw = readFileSync(join(__dirname, '..', '..', 'worldhub', 'application-contract.json'), 'utf8')
    expect(raw).not.toContain('landscape_16x9')
    expect(raw).not.toContain('portrait_9x16')
    expect(raw).not.toContain('character.identity_tile')
    expect(raw).not.toContain('character.expression')
  })
})

describe('recipe resolution', () => {
  it('prefers the current recipe when a package offers both', () => {
    const both = pkg([{ recipeId: 'landscape_16x9' }, { recipeId: 'tile_16x9' }])
    expect(assetFile(both, 'a1', WIDE)?.recipeId).toBe('tile_16x9')

    const portraits = pkg([{ recipeId: 'portrait_9x16' }, { recipeId: 'portrait_3x4' }])
    expect(assetFile(portraits, 'a1', PORTRAIT)?.recipeId).toBe('portrait_3x4')
  })

  it('still resolves publications packaged under the older contract', () => {
    expect(assetFile(pkg([{ recipeId: 'landscape_16x9' }]), 'a1', WIDE)?.recipeId).toBe('landscape_16x9')
    expect(assetFile(pkg([{ recipeId: 'portrait_9x16' }]), 'a1', PORTRAIT)?.recipeId).toBe('portrait_9x16')
    expect(assetFile(pkg([{ recipeId: 'square' }]), 'a1', TILE)?.recipeId).toBe('square')
  })

  it('reads character tiles as 16:9 first, falling back to the old square crop', () => {
    const both = pkg([{ recipeId: 'square' }, { recipeId: 'tile_16x9' }])
    expect(assetFile(both, 'a1', TILE)?.recipeId).toBe('tile_16x9')
  })

  it('falls back to any available rendition rather than losing the art', () => {
    expect(assetFile(pkg([{ recipeId: 'something_else' }]), 'a1', WIDE)?.recipeId).toBe('something_else')
    expect(assetFile(pkg([]), 'a1', WIDE)).toBeNull()
  })
})

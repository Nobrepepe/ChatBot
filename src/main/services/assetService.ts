import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { mediaRoot } from '../paths'

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'unnamed'
}

/**
 * Copies a picked file into the media root and returns its media-relative
 * path (the DB never stores absolute paths). Name collisions get _1, _2…
 */
export function importFile(sourceAbsPath: string, relativeDir: string): string {
  const destDir = join(mediaRoot(), relativeDir)
  mkdirSync(destDir, { recursive: true })
  const ext = extname(sourceAbsPath)
  const stem = slugify(basename(sourceAbsPath, ext))
  let candidate = `${stem}${ext}`
  let counter = 0
  while (existsSync(join(destDir, candidate))) {
    counter += 1
    candidate = `${stem}_${counter}${ext}`
  }
  copyFileSync(sourceAbsPath, join(destDir, candidate))
  return `${relativeDir}/${candidate}`.replace(/\\/g, '/')
}

export const importWorldCover = (src: string, worldName: string): string =>
  importFile(src, `worlds/${slugify(worldName)}/covers`)

export const importSessionBackground = (src: string, worldName: string): string =>
  importFile(src, `worlds/${slugify(worldName)}/session_backgrounds`)

export const importCharacterImage = (src: string, worldName: string, characterName: string): string =>
  importFile(src, `worlds/${slugify(worldName)}/characters/${slugify(characterName)}`)

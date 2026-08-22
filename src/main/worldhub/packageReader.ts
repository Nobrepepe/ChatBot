/**
 * World Hub package reading and protocol validation.
 *
 * Implements the consumer side of World Hub Package Protocol 1: safe ZIP
 * extraction, manifest and embedded-contract validation, full checksum
 * verification, and reference resolution — all before any application state
 * changes. This module knows the protocol, not the application.
 */

import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join, resolve, sep, extname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

export const SUPPORTED_PROTOCOL_VERSIONS = new Set([1])
export const SUPPORTED_CONTRACT_VERSIONS = new Set([1])
export const PACKAGE_FORMAT = 'world-hub-package'
export const CONTRACT_FORMAT = 'world-hub-application-contract'

/** A package failed validation. The message is user-facing. */
export class PackageError extends Error {
  code = 'package'
  constructor(message: string) {
    super(message)
    this.name = 'PackageError'
  }
}

export interface AssetIndexEntry {
  assetId: string
  versionId: string
  path: string
  recipeId: string
  [key: string]: unknown
}

export interface PackageInfo {
  root: string
  manifest: Record<string, any>
  contract: Record<string, any>
  content: Record<string, any>
  entities: Record<string, any>[]
  worlds: Record<string, any>[]
  characters: Record<string, any>[]
  relationships: Record<string, any>[]
  documents: Record<string, any>[]
  assetIndex: AssetIndexEntry[]
  checksums: Record<string, string>
  tags: Record<string, any>[]
}

export const publicationId = (p: PackageInfo): string => p.manifest['publicationId']

export function entitiesById(p: PackageInfo): Map<string, Record<string, any>> {
  return new Map(p.entities.map((e) => [e['id'], e]))
}

/** The best index entry for an asset given a recipe preference order. */
export function assetFile(
  p: PackageInfo,
  assetId: string,
  preferredRecipes: string[]
): AssetIndexEntry | null {
  const entries = p.assetIndex.filter((e) => e.assetId === assetId)
  for (const recipe of preferredRecipes) {
    const match = entries.find((e) => e.recipeId === recipe)
    if (match) return match
  }
  return entries[0] ?? null
}

export const packageAbsolute = (p: PackageInfo, packagePath: string): string =>
  join(p.root, ...packagePath.split('/'))

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Extract a package ZIP, refusing unsafe entries outright. */
export async function extractZipSafely(zipPath: string, destination: string): Promise<void> {
  mkdirSync(destination, { recursive: true })
  const resolvedDestination = resolve(destination)
  const seen = new Set<string>()

  const zipfile = await new Promise<yauzl.ZipFile>((resolveOpen, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, file) => {
      if (err || !file) reject(new PackageError('The file is not a readable ZIP archive.'))
      else resolveOpen(file)
    })
  })

  try {
    await new Promise<void>((resolveAll, reject) => {
      zipfile.on('error', () => reject(new PackageError('The file is not a readable ZIP archive.')))
      zipfile.on('end', () => resolveAll())
      zipfile.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          try {
            const name = entry.fileName
            if (name.endsWith('/')) {
              zipfile.readEntry()
              return
            }
            if (seen.has(name)) {
              throw new PackageError('The archive contains duplicate entries and was rejected.')
            }
            seen.add(name)
            const normalized = name.replace(/\\/g, '/')
            const segments = normalized.split('/')
            if (normalized.startsWith('/') || segments.includes('..') || segments[0]!.includes(':')) {
              throw new PackageError('The archive contains unsafe file paths and was rejected.')
            }
            if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
              throw new PackageError('The archive contains symbolic links and was rejected.')
            }
            const target = resolve(join(destination, ...segments))
            if (target !== resolvedDestination && !target.startsWith(resolvedDestination + sep)) {
              throw new PackageError('The archive contains unsafe file paths and was rejected.')
            }
            mkdirSync(join(target, '..'), { recursive: true })
            const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => {
              zipfile.openReadStream(entry, (err, s) => (err || !s ? rej(err) : res(s)))
            })
            await pipeline(stream, createWriteStream(target))
            zipfile.readEntry()
          } catch (err) {
            reject(err)
          }
        })()
      })
      zipfile.readEntry()
    })
  } finally {
    zipfile.close()
  }
}

function readJson(root: string, packagePath: string): unknown {
  const path = join(root, ...packagePath.split('/'))
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new PackageError(`The package is missing ${packagePath}.`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new PackageError(`The package file ${packagePath} is not valid JSON.`)
  }
}

function* walkFiles(dir: string, prefix = ''): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    const relative = prefix ? `${prefix}/${name}` : name
    if (statSync(path).isDirectory()) yield* walkFiles(path, relative)
    else yield relative
  }
}

/** Validate a package directory completely; throw PackageError otherwise. */
export function loadPackage(root: string, expectedAppType: string): PackageInfo {
  const manifest = readJson(root, 'manifest.json') as Record<string, any>
  if (typeof manifest !== 'object' || manifest === null || manifest['format'] !== PACKAGE_FORMAT) {
    throw new PackageError('This is not a World Hub package.')
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(manifest['protocolVersion'])) {
    throw new PackageError('This package uses a newer World Hub protocol than this app understands.')
  }
  if (manifest['complete'] !== true) {
    throw new PackageError('The package is marked incomplete.')
  }
  if (manifest['applicationType'] !== expectedAppType) {
    throw new PackageError(`This package is for “${manifest['applicationType']}”, not for this app.`)
  }
  for (const key of ['publicationId', 'production', 'contract', 'sourceLibraryId', 'publishedAt', 'entities', 'sections']) {
    if (!(key in manifest)) throw new PackageError(`The package manifest is missing ${key}.`)
  }

  const contract = readJson(root, 'production/contract.json') as Record<string, any>
  if (typeof contract !== 'object' || contract === null || contract['format'] !== CONTRACT_FORMAT) {
    throw new PackageError('The embedded application contract is not valid.')
  }
  if (contract['appType'] !== manifest['applicationType']) {
    throw new PackageError("The embedded contract does not match the package's application type.")
  }
  // Compatibility is decided by the contract's *format* version, which the
  // embedded document declares. manifest.contract.version is the Hub's
  // revision counter for that contract record — it climbs every time the
  // author edits the contract (renaming a recipe, adding a field), and
  // gating on it would break every consumer on every edit.
  if (!SUPPORTED_CONTRACT_VERSIONS.has(contract['contractVersion'])) {
    throw new PackageError('This package uses a contract format this app does not support.')
  }

  const checksums = readJson(root, 'checksums.json') as Record<string, string>
  if (typeof checksums !== 'object' || checksums === null || Array.isArray(checksums)) {
    throw new PackageError('The package checksum list is unreadable.')
  }
  for (const [packagePath, expected] of Object.entries(checksums)) {
    const filePath = join(root, ...packagePath.split('/'))
    let stat
    try {
      stat = statSync(filePath)
    } catch {
      throw new PackageError(`The package is missing ${packagePath}.`)
    }
    if (!stat.isFile()) throw new PackageError(`The package is missing ${packagePath}.`)
    if (sha256File(filePath) !== expected) {
      throw new PackageError(`A package file failed its checksum: ${packagePath}.`)
    }
  }
  const listed = new Set([...Object.keys(checksums), 'checksums.json'])
  for (const relative of walkFiles(root)) {
    if (!listed.has(relative)) {
      throw new PackageError(`The package contains an unlisted file: ${relative}.`)
    }
  }

  const entities = readJson(root, 'catalog/entities.json') as Record<string, any>[]
  const worlds = readJson(root, 'catalog/worlds.json') as Record<string, any>[]
  const characters = readJson(root, 'catalog/characters.json') as Record<string, any>[]
  const relationships = readJson(root, 'catalog/relationships.json') as Record<string, any>[]
  const documents = readJson(root, 'catalog/documents.json') as Record<string, any>[]
  const tags = readJson(root, 'catalog/tags.json') as Record<string, any>[]
  const assetIndex = readJson(root, 'assets/index.json') as AssetIndexEntry[]
  const content = readJson(root, 'production/content.json') as Record<string, any>

  const entityIds = new Set(entities.map((e) => e['id']))
  for (const relationship of relationships) {
    if (!entityIds.has(relationship['sourceId']) || !entityIds.has(relationship['targetId'])) {
      throw new PackageError('A packaged relationship references a missing record.')
    }
  }
  for (const document of documents) {
    for (const entityId of document['entityIds'] ?? []) {
      if (!entityIds.has(entityId)) {
        throw new PackageError('A packaged document references a missing record.')
      }
    }
    try {
      statSync(join(root, ...String(document['path']).split('/')))
    } catch {
      throw new PackageError(`A document file is missing: ${document['path']}.`)
    }
  }
  const assetIds = new Set(assetIndex.map((e) => e.assetId))
  for (const entry of assetIndex) {
    try {
      statSync(join(root, ...entry.path.split('/')))
    } catch {
      throw new PackageError(`An asset file is missing: ${entry.path}.`)
    }
  }
  for (const world of worlds) {
    for (const ref of [world['coverAssetId'], world['backgroundAssetId']]) {
      if (ref && !assetIds.has(ref)) {
        throw new PackageError('A world profile references a missing asset.')
      }
    }
  }
  for (const character of characters) {
    for (const ref of [character['portraitAssetId'], character['fullBodyAssetId']]) {
      if (ref && !assetIds.has(ref)) {
        throw new PackageError('A character profile references a missing asset.')
      }
    }
  }
  for (const [slot, selected] of Object.entries(content['selections'] ?? {})) {
    for (const entityId of selected as string[]) {
      if (!entityIds.has(entityId)) {
        throw new PackageError(`Selection “${slot}” references a missing record.`)
      }
    }
  }
  for (const [setKey, items] of Object.entries(content['assetSets'] ?? {})) {
    for (const item of items as Record<string, any>[]) {
      if (!assetIds.has(item['assetId'])) {
        throw new PackageError(`Asset set “${setKey}” references a missing asset.`)
      }
    }
  }

  return {
    root,
    manifest,
    contract,
    content,
    entities,
    worlds,
    characters,
    relationships,
    documents,
    assetIndex,
    checksums,
    tags
  }
}

/** Read current.json from a linked World Hub production folder. */
export function readCurrentPointer(productionDir: string): Record<string, any> | null {
  try {
    const pointer = JSON.parse(readFileSync(join(productionDir, 'current.json'), 'utf8'))
    if (typeof pointer !== 'object' || pointer === null || !('publicationId' in pointer)) return null
    return pointer
  } catch {
    return null
  }
}

export { extname }

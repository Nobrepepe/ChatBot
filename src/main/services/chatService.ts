/**
 * Chat orchestration: context loading, prompt building, streaming, and the
 * one-shot features (summarize, impersonate, suggest memories, continuation).
 * The caller (IPC layer) persists streamed replies via saveReply.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Character, Memory, MemoryProposal, Persona, Scene, World } from '@shared/types'
import { parseEmotion, parseSpeakerPrefix, stripWirePrefixes } from '@shared/wireFormat'
import { exportsDir } from '../paths'
import * as scenesRepo from '../db/repo/scenes'
import * as messagesRepo from '../db/repo/messages'
import * as charactersRepo from '../db/repo/characters'
import * as worldsRepo from '../db/repo/worlds'
import * as personasRepo from '../db/repo/personas'
import * as loreRepo from '../db/repo/lore'
import * as memoriesRepo from '../db/repo/memories'
import * as settingsRepo from '../db/repo/settings'
import {
  buildPrompt,
  matchLore,
  DEFAULT_LORE_BUDGET,
  type BuiltPrompt,
  type LoreMatch
} from '../prompt/promptBuilder'
import {
  buildContinuationPrompt,
  buildImpersonationPrompt,
  buildMemorySuggestionPrompt,
  buildSummaryPrompt
} from '../prompt/auxPrompts'
import { streamChat, type ChatMessage } from '../providers/openaiCompat'
import { parseMemoryActions, parseMemoryBullets, type MemoryAction } from './memoriesService'

export interface ChatContext {
  scene: Scene
  world: World
  characters: Character[]
  persona: Persona | null
}

export function loadContext(sceneId: number): ChatContext {
  const scene = scenesRepo.getScene(sceneId)
  if (!scene) throw new Error('This scene no longer exists.')
  const world = worldsRepo.getWorld(scene.worldId)
  if (!world) throw new Error("The scene's world no longer exists.")
  const characters = scene.characterIds
    .map((id) => charactersRepo.getCharacter(id))
    .filter((c): c is Character => c !== null)
  if (characters.length === 0) throw new Error('This scene has no characters left.')
  const persona = scene.personaId ? personasRepo.getPersona(scene.personaId) : null
  return { scene, world, characters, persona }
}

function historyLimit(): number {
  const raw = Number(settingsRepo.getSettings().historyLimit)
  return Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 30)
}

/** Characters of lore allowed per prompt; 0 means send every match. */
function loreBudget(): number {
  const raw = Number(settingsRepo.getSettings().loreBudget)
  return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : DEFAULT_LORE_BUDGET
}

/** Emotion tags are on when any scene character has sprites (never in author mode). */
export function emotionTagsEnabled(ctx: ChatContext): boolean {
  if (ctx.scene.mode === 'author') return false
  return ctx.characters.some((c) => charactersRepo.listCharacterSprites(c.id).length > 0 || c.portraitPath)
}

/** Bare call sign -> display name for the responder (portrait doubles as neutral). */
export function spriteMap(responder: Character): Record<string, string> {
  const map: Record<string, string> = {}
  if (responder.portraitPath) map['neutral'] = 'Main portrait'
  for (const sprite of charactersRepo.listCharacterSprites(responder.id)) {
    map[sprite.callSign] = sprite.name
  }
  return map
}

export interface BuildOptions {
  beforeMessageId?: number
  responderId?: number | null
  respondToLatest?: boolean
}

export interface BuildResult {
  built: BuiltPrompt
  ctx: ChatContext
  loreMatches: LoreMatch[]
  responder: Character
  emotionTags: boolean
  /** call signs valid for the responder, bare */
  callSigns: string[]
}

export function build(sceneId: number, options: BuildOptions = {}): BuildResult {
  // Reload everything so scene/summary/profile edits apply to the next message.
  const ctx = loadContext(sceneId)
  const settings = settingsRepo.getSettings()

  let history = messagesRepo.listMessages(sceneId)
  if (options.beforeMessageId) {
    const index = history.findIndex((m) => m.id === options.beforeMessageId)
    if (index >= 0) history = history.slice(0, index)
  }

  const memoriesByChar = new Map<number, Memory[]>()
  for (const c of ctx.characters) {
    memoriesByChar.set(
      c.id,
      memoriesRepo.listMemories(c.id, { types: ['canon', 'relationship'], lifecycle: 'canonical' })
    )
  }

  const loreMatches = matchLore(loreRepo.listLoreEntries(ctx.world.id), ctx.scene, history)

  const responder =
    (options.responderId != null && ctx.characters.find((c) => c.id === options.responderId)) ||
    ctx.characters[0]!
  const emotionTags = emotionTagsEnabled(ctx)
  const sprites = emotionTags ? spriteMap(responder) : null

  const built = buildPrompt({
    world: ctx.world,
    characters: ctx.characters,
    scene: ctx.scene,
    memoriesByChar,
    loreMatches,
    persona: ctx.persona,
    history,
    historyLimit: historyLimit(),
    emotionTags,
    sprites,
    responder: ctx.characters.length > 1 ? responder : null,
    respondToLatest: options.respondToLatest ?? false,
    systemPrompt: settings.systemPrompt,
    loreBudget: loreBudget()
  })

  // A trailing assistant message would read as a prefill to some models; close
  // the turn with an explicit control message instead. Never persisted or shown.
  if (options.respondToLatest && ctx.characters.length > 1) {
    built.messages.push({
      role: 'user',
      content:
        `[Turn control: ${responder.name} now responds directly to the previous ` +
        'reply. Do not write for anyone else.]'
    })
  }

  return {
    built,
    ctx,
    loreMatches,
    responder,
    emotionTags,
    callSigns: sprites ? Object.keys(sprites) : []
  }
}

export function addUserMessage(sceneId: number, content: string): number {
  return messagesRepo.addMessage({ sceneId, role: 'user', content })
}

export interface SavedReply {
  messageId: number
  characterId: number | null
  emotion: string
  content: string
}

/**
 * Parse the finished raw stream text ({Name} and [emotion] wire tags) and
 * persist a clean structured row.
 */
export function saveReply(sceneId: number, raw: string, buildResult: BuildResult): SavedReply {
  const { ctx, responder, callSigns } = buildResult
  const names = ctx.characters.map((c) => c.name)
  const speaker = parseSpeakerPrefix(raw, names)
  const afterSpeaker = speaker ? speaker.rest : raw
  const { emotion, rest } = parseEmotion(afterSpeaker, callSigns.length ? callSigns : undefined)
  const content = rest.trim()

  const speakerCharacter = speaker
    ? ctx.characters.find((c) => c.name === speaker.name)
    : responder
  const characterId = speakerCharacter?.id ?? responder.id

  const messageId = messagesRepo.addMessage({
    sceneId,
    role: 'character',
    characterId,
    content,
    emotion
  })
  return { messageId, characterId, emotion, content }
}

export async function* streamReply(
  sceneId: number,
  options: BuildOptions,
  signal: AbortSignal
): AsyncGenerator<string> {
  const result = build(sceneId, options)
  const settings = settingsRepo.getSettings()
  yield* streamChat(result.built.messages, settings, signal)
}

export async function* streamContinuation(
  sceneId: number,
  messageId: number,
  partial: string,
  signal: AbortSignal
): AsyncGenerator<string> {
  const result = build(sceneId, { beforeMessageId: messageId })
  const messages = buildContinuationPrompt(result.built, partial)
  yield* streamChat(messages, settingsRepo.getSettings(), signal)
}

async function runOnce(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const parts: string[] = []
  for await (const chunk of streamChat(messages, settingsRepo.getSettings(), signal)) {
    parts.push(chunk)
  }
  return parts.join('').trim()
}

export async function summarize(sceneId: number, signal?: AbortSignal): Promise<string> {
  const ctx = loadContext(sceneId)
  const history = messagesRepo.listMessages(sceneId)
  const summary = await runOnce(buildSummaryPrompt(ctx.characters, ctx.scene, history), signal)
  scenesRepo.setSceneSummary(sceneId, summary)
  return summary
}

export async function impersonate(
  sceneId: number,
  draft = '',
  signal?: AbortSignal
): Promise<string> {
  const result = build(sceneId)
  const persona = result.ctx.persona
  if (!persona) throw new Error('Choose a persona in scene setup first.')
  const raw = await runOnce(buildImpersonationPrompt(result.built, persona, draft), signal)
  // The reply prompt is reused as-is, so its {Name} and [emotion] rules are
  // still in front of the model; drop the tags rather than paste them into
  // the composer.
  const names = [...result.ctx.characters.map((c) => c.name), persona.name]
  return stripWirePrefixes(raw, names, result.callSigns).content.trim()
}

/** Writes the scene as a Markdown transcript; returns the absolute path. */
export function exportScene(sceneId: number): string {
  const ctx = loadContext(sceneId)
  const history = messagesRepo.listMessages(sceneId)
  const nameById = new Map(ctx.characters.map((c) => [c.id, c.name]))
  const lines = [`# ${ctx.scene.title || 'Scene'}`, '']
  for (const m of history) {
    if (m.role === 'system-note') continue
    const speaker =
      m.role === 'user'
        ? (ctx.persona?.name ?? 'You')
        : m.role === 'narrator'
          ? 'Narrator'
          : ((m.characterId != null && nameById.get(m.characterId)) ?? ctx.characters[0]!.name)
    lines.push(`**${speaker}:** ${m.content}`, '')
  }
  const dir = exportsDir()
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace('.', '_')
  const file = join(dir, `scene_${sceneId}_${stamp}.md`)
  writeFileSync(file, lines.join('\n'))
  return file
}

/**
 * Reads the scene and proposes memory actions for review. Nothing becomes
 * canon here: a create allocates a memory row marked 'proposed' so the next
 * pass can revise that same id, and every action waits for the user.
 */
export async function proposeMemories(
  sceneId: number,
  signal?: AbortSignal
): Promise<MemoryProposal[]> {
  const ctx = loadContext(sceneId)
  const history = messagesRepo.listMessages(sceneId)
  const characterIds = ctx.characters.map((c) => c.id)

  const memoriesByChar = new Map<number, Memory[]>()
  const ownerOf = new Map<number, number>()
  for (const c of ctx.characters) {
    const memories = memoriesRepo.listMemories(c.id, { lifecycle: 'any' })
    memoriesByChar.set(
      c.id,
      memories.filter((m) => m.lifecycleStatus === 'canonical')
    )
    for (const m of memories) ownerOf.set(m.id, c.id)
  }

  const raw = await runOnce(
    buildMemorySuggestionPrompt({
      characters: ctx.characters,
      scene: ctx.scene,
      history,
      memoriesByChar,
      ledger: memoriesRepo.listCastProposalLedger(characterIds)
    }),
    signal
  )

  const memoryIds = memoriesRepo.listProposableMemoryIds(characterIds)
  let { actions } = parseMemoryActions(raw, { memoryIds, ownerOf, characters: ctx.characters })
  if (actions.length === 0) actions = parseMemoryBullets(raw, ctx.characters)
  actions = actions.filter((action) => !alreadySaid(action, memoriesByChar))

  const saved: number[] = []
  for (const action of actions.slice(0, MAX_MEMORY_ACTIONS)) {
    try {
      saved.push(
        memoriesRepo.saveMemorySuggestion({
          sceneId,
          characterId: action.characterId,
          actionType: action.actionType,
          targetMemoryId: action.targetMemoryId,
          payload: action.payload
        })
      )
    } catch {
      // A target that vanished between the prompt and the answer is not worth
      // failing the whole pass over; the rest of the actions still stand.
    }
  }
  if (!saved.length) return []
  const bySaved = new Set(saved)
  return memoriesRepo.listSceneProposals(sceneId).filter((p) => bySaved.has(p.id))
}

/**
 * The prompt asks for at most six actions; this is the hard ceiling, so a
 * model that ignores the request still cannot rewrite a character wholesale.
 */
const MAX_MEMORY_ACTIONS = 8

const normalize = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * An action that would change nothing: a fact the character already carries
 * word for word, or a rewrite into the words already there. Models repeat
 * themselves across passes, and with automatic memories nobody is there to
 * catch it, so the same fact would otherwise accumulate a copy every few
 * messages.
 */
function alreadySaid(action: MemoryAction, memoriesByChar: Map<number, Memory[]>): boolean {
  if (action.actionType === 'forget') return false
  const content = normalize(String(action.payload['content'] ?? ''))
  if (!content) return true
  const held = memoriesByChar.get(action.characterId) ?? []

  if (action.actionType === 'replace') {
    const target = held.find((m) => m.id === action.targetMemoryId)
    return !!target && normalize(target.content) === content
  }
  if (held.some((m) => normalize(m.content) === content)) return true
  return memoriesRepo
    .listCharacterProposals(action.characterId)
    .some((p) => p.actionType === 'create' && normalize(p.proposedContent) === content)
}

export type { MemoryAction }

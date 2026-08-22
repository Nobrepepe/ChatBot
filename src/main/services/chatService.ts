/**
 * Chat orchestration: context loading, prompt building, streaming, and the
 * one-shot features (summarize, impersonate, suggest memories, continuation).
 * The caller (IPC layer) persists streamed replies via saveReply.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Character, Memory, Persona, Scene, World } from '@shared/types'
import { parseEmotion, parseSpeakerPrefix } from '@shared/wireFormat'
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
      memoriesRepo.listMemories(c.id, { types: ['canon', 'relationship'], status: 'approved' })
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
    systemPrompt: settings.systemPrompt
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

async function runOnce(messages: ChatMessage[]): Promise<string> {
  const parts: string[] = []
  for await (const chunk of streamChat(messages, settingsRepo.getSettings())) {
    parts.push(chunk)
  }
  return parts.join('').trim()
}

export async function summarize(sceneId: number): Promise<string> {
  const ctx = loadContext(sceneId)
  const history = messagesRepo.listMessages(sceneId)
  const summary = await runOnce(buildSummaryPrompt(ctx.characters, ctx.scene, history))
  scenesRepo.setSceneSummary(sceneId, summary)
  return summary
}

export async function impersonate(sceneId: number, draft = ''): Promise<string> {
  const result = build(sceneId)
  if (!result.ctx.persona) throw new Error('Choose a persona in scene setup first.')
  return runOnce(buildImpersonationPrompt(result.built, result.ctx.persona, draft))
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

const SUGGESTION_LINE_RE = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/

function guessCharacter(line: string, characters: Character[]): Character {
  const lowered = line.toLowerCase()
  return characters.find((c) => lowered.includes(c.name.toLowerCase())) ?? characters[0]!
}

/** Persist each suggested fact as a pending canon memory for review. */
export async function suggestMemories(sceneId: number): Promise<Memory[]> {
  const ctx = loadContext(sceneId)
  const history = messagesRepo.listMessages(sceneId)
  const raw = await runOnce(buildMemorySuggestionPrompt(ctx.characters, ctx.scene, history))
  const saved: Memory[] = []
  for (const line of raw.split('\n')) {
    const m = SUGGESTION_LINE_RE.exec(line)
    if (!m?.[1]) continue
    const content = m[1]
    const character = guessCharacter(content, ctx.characters)
    const id = memoriesRepo.saveMemory({
      characterId: character.id,
      type: 'canon',
      content,
      sourceSceneId: sceneId,
      status: 'pending'
    })
    saved.push({
      id,
      characterId: character.id,
      type: 'canon',
      content,
      sourceSceneId: sceneId,
      status: 'pending',
      createdAt: ''
    })
  }
  return saved
}

/**
 * Chat orchestration: context loading, prompt building, streaming, and the
 * one-shot features (summarize, impersonate, suggest memories, continuation).
 * The caller (IPC layer) persists streamed replies via saveReply.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Character,
  Memory,
  MemoryProposal,
  Message,
  Persona,
  Scene,
  World
} from '@shared/types'
import type { Responder } from '@shared/ipc'
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
  buildSummaryPrompt,
  directReplyInstruction,
  extraTurnInstruction
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

/**
 * Who this turn was asked of, once the scene has been loaded. A cast member is
 * a row; an extra is only ever a name, and an empty one means the model works
 * out from the scene who is plausibly there.
 */
export type ResolvedResponder =
  | { kind: 'character'; character: Character }
  | { kind: 'extra'; name: string }

export interface BuildOptions {
  beforeMessageId?: number
  responder?: Responder
  respondToLatest?: boolean
}

export interface BuildResult {
  built: BuiltPrompt
  ctx: ChatContext
  loreMatches: LoreMatch[]
  /** Who the turn was asked of. */
  responder: ResolvedResponder
  /**
   * The cast member the prompt is written around: the sprite owner, and the
   * speaker a reply falls back to. An extra request leaves this exactly where
   * it would otherwise be, which is what keeps the system section — and the
   * server's prefix cache — untouched by asking for a passer-by.
   */
  lead: Character
  emotionTags: boolean
  /** call signs valid for the lead, bare */
  callSigns: string[]
}

/** The extras standing in the window the model will actually be sent. */
function knownExtras(history: Message[], limit: number): string[] {
  const visible = history.filter((m) => !m.deletedAt && m.role !== 'system-note')
  const window = visible.length > limit ? visible.slice(-limit) : visible
  return [
    ...new Set(window.filter((m) => m.role === 'extra' && m.speakerName).map((m) => m.speakerName))
  ]
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

  const asked = options.responder
  // An extra never becomes the lead: the prompt stays written around the cast
  // member it would have been written around anyway — including the responder
  // lock, which the trailing OOC turn then overrides the way impersonation
  // overrides "never speak for the user". Calling on a passer-by therefore
  // costs nothing at token zero.
  const leadId = asked?.kind === 'extra' ? asked.leadId : asked?.characterId
  const lead =
    (leadId != null && ctx.characters.find((c) => c.id === leadId)) || ctx.characters[0]!
  const responder: ResolvedResponder =
    asked?.kind === 'extra'
      ? { kind: 'extra', name: (asked.name ?? '').trim() }
      : { kind: 'character', character: lead }

  const limit = historyLimit()
  const emotionTags = emotionTagsEnabled(ctx)
  const sprites = emotionTags ? spriteMap(lead) : null

  const built = buildPrompt({
    world: ctx.world,
    characters: ctx.characters,
    scene: ctx.scene,
    memoriesByChar,
    loreMatches,
    persona: ctx.persona,
    history,
    historyLimit: limit,
    emotionTags,
    sprites,
    responder: ctx.characters.length > 1 ? lead : null,
    respondToLatest: responder.kind === 'character' && (options.respondToLatest ?? false),
    systemPrompt: settings.systemPrompt,
    loreBudget: loreBudget()
  })

  // One place closes the turn. A trailing assistant message would read as a
  // prefill to some models, so a turn that has been directed at someone is
  // closed with a user turn. Never persisted or shown.
  if (responder.kind === 'extra') {
    built.messages.push({
      role: 'user',
      content: extraTurnInstruction({
        hint: responder.name,
        known: knownExtras(history, limit),
        respondToLatest: options.respondToLatest ?? false
      })
    })
  } else if (options.respondToLatest && ctx.characters.length > 1) {
    built.messages.push({ role: 'user', content: directReplyInstruction(lead.name) })
  }

  return {
    built,
    ctx,
    loreMatches,
    responder,
    lead,
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
  /** The extra's name, or '' when a cast member answered. */
  speakerName: string
  emotion: string
  content: string
}

/** The label an extra falls back to when the reply carried no name at all. */
export const UNNAMED_EXTRA = 'Someone'

/**
 * Parse the finished raw stream text ({Name} and [emotion] wire tags) and
 * persist a clean structured row.
 */
export function saveReply(sceneId: number, raw: string, buildResult: BuildResult): SavedReply {
  const { ctx, responder, lead, callSigns } = buildResult

  if (responder.kind === 'extra') return saveExtraReply(sceneId, raw, buildResult)

  const names = ctx.characters.map((c) => c.name)
  const speaker = parseSpeakerPrefix(raw, names)
  const afterSpeaker = speaker ? speaker.rest : raw
  const { emotion, rest } = parseEmotion(afterSpeaker, callSigns.length ? callSigns : undefined)
  const content = rest.trim()

  const speakerCharacter = speaker
    ? ctx.characters.find((c) => c.name === speaker.name)
    : responder.character
  const characterId = speakerCharacter?.id ?? lead.id

  const messageId = messagesRepo.addMessage({
    sceneId,
    role: 'character',
    characterId,
    content,
    emotion
  })
  return { messageId, characterId, speakerName: '', emotion, content }
}

/**
 * An extra's turn. The {Name} tag is read unrestricted here — the whole point
 * is a name the app has never seen — and a model that answered as a cast
 * member anyway is taken at its word rather than having the line reattributed
 * to a stranger. Extras have no sprites, so a stray call sign is stripped from
 * the text instead of being stored.
 */
function saveExtraReply(sceneId: number, raw: string, buildResult: BuildResult): SavedReply {
  const { ctx, responder, callSigns } = buildResult
  const asked = responder.kind === 'extra' ? responder.name : ''
  const speaker = parseSpeakerPrefix(raw)
  const afterSpeaker = speaker ? speaker.rest : raw

  const castMember = speaker
    ? ctx.characters.find((c) => c.name.toLowerCase() === speaker.name.toLowerCase())
    : undefined
  if (castMember) {
    const { emotion, rest } = parseEmotion(afterSpeaker, callSigns.length ? callSigns : undefined)
    const content = rest.trim()
    const messageId = messagesRepo.addMessage({
      sceneId,
      role: 'character',
      characterId: castMember.id,
      content,
      emotion
    })
    return { messageId, characterId: castMember.id, speakerName: '', emotion, content }
  }

  const speakerName = speaker?.name.trim() || asked || UNNAMED_EXTRA
  const content = parseEmotion(afterSpeaker).rest.trim()
  const messageId = messagesRepo.addMessage({
    sceneId,
    role: 'extra',
    speakerName,
    content
  })
  return { messageId, characterId: null, speakerName, emotion: '', content }
}

/** The prompt is built once per turn and streamed from; the caller keeps it for saveReply. */
export async function* streamReply(
  buildResult: BuildResult,
  signal: AbortSignal
): AsyncGenerator<string> {
  yield* streamChat(buildResult.built.messages, settingsRepo.getSettings(), signal)
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
          : m.role === 'extra'
            ? m.speakerName || UNNAMED_EXTRA
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

import type { HubStatus, IpcResult, RendererApi, StreamEvent, ChatStartParams } from '@shared/ipc'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type Character,
  type CharacterSprite,
  type LoreEntry,
  type Memory,
  type Message,
  type NoteChatMessage,
  type NoteSuggestion,
  type Persona,
  type Scene,
  type SceneTemplate,
  type World,
  type WorldNote
} from '@shared/types'

/**
 * An in-memory stand-in for the main process. Screens talk to it through the
 * real window.api contract, so tests exercise the same call paths as the app.
 */

export type SeededNote = WorldNote & { fingerprint: string }

export interface FakeStore {
  worlds: World[]
  characters: Character[]
  sprites: CharacterSprite[]
  scenes: Scene[]
  messages: Message[]
  memories: Memory[]
  lore: LoreEntry[]
  personas: Persona[]
  templates: SceneTemplate[]
  notes: SeededNote[]
  noteChat: NoteChatMessage[]
  suggestions: NoteSuggestion[]
  settings: AppSettings
  hub: HubStatus
  /** Path returned by the next assets:importImage call; null cancels. */
  nextImportPath: string | null
}

export interface FakeApi {
  store: FakeStore
  /** Every invoke, in order, as [channel, ...args]. */
  calls: [string, ...unknown[]][]
  /** Params of each chat:start, keyed by the requestId handed back. */
  streams: Map<number, ChatStartParams>
  lastRequestId: number
  emit: (event: StreamEvent) => void
  chunk: (requestId: number, delta: string) => void
  done: (requestId: number) => void
  fail: (requestId: number, message: string) => void
  /** Force a channel to reject, to exercise error paths. */
  failNext: (channel: string, message: string, code?: string) => void
  /** Hold every later call to a channel unanswered, to exercise in-flight UI. */
  defer: (channel: string) => void
  /** Answer everything defer() is holding and stop holding new calls. */
  release: (channel: string) => void
  callsTo: (channel: string) => unknown[][]
}

let nextId = 1
export const resetIds = (): void => {
  nextId = 1
}
const id = (): number => nextId++

// ---- seed builders -------------------------------------------------------

const NOW = '2026-08-22T00:00:00.000Z'

export function makeWorld(over: Partial<World> = {}): World {
  return {
    id: id(),
    name: 'Hidden Village',
    genre: 'Fantasy',
    tone: 'Wistful',
    summary: 'A village that unmakes itself at dawn.',
    settingDescription: '',
    styleGuide: '',
    coverImagePath: '',
    sessionBackgroundPath: '',
    hubId: null,
    publicationId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over
  }
}

export function makeCharacter(over: Partial<Character> = {}): Character {
  return {
    id: id(),
    worldId: 1,
    name: 'Ayame',
    nicknames: '',
    age: '',
    role: '',
    summary: '',
    appearance: '',
    personality: '',
    backstory: '',
    behaviorRules: '',
    voiceStyle: '',
    relationshipToUser: '',
    aiInstructions: '',
    portraitPath: 'worlds/hv/ayame.png',
    tileImagePath: 'worlds/hv/ayame_tile.png',
    hubId: null,
    publicationId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over
  }
}

export function makeScene(over: Partial<Scene> = {}): Scene {
  return {
    id: id(),
    worldId: 1,
    locationId: null,
    title: 'The rooftop',
    premise: 'A storm traps everyone inside.',
    tone: '',
    timeOfDay: '',
    relationshipStatus: '',
    mode: 'roleplay',
    summary: '',
    narratorEnabled: false,
    personaId: null,
    publicationId: null,
    displayMode: null,
    characterIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over
  }
}

export function makeMessage(over: Partial<Message> = {}): Message {
  return {
    id: id(),
    sceneId: 1,
    role: 'user',
    characterId: null,
    content: 'hello',
    emotion: '',
    deletedAt: null,
    createdAt: NOW,
    ...over
  }
}

export function makeNote(over: Partial<SeededNote> = {}): SeededNote {
  const base: WorldNote = {
    id: id(),
    worldId: 1,
    title: 'The Harbor',
    content: 'Tides govern the festival calendar.',
    category: 'Setting',
    isPinned: false,
    contextMode: 'relevant',
    lastOpenedAt: null,
    lifecycleStatus: 'canonical',
    workspaceSessionId: null,
    proposalMessageId: null,
    createdAt: NOW,
    updatedAt: NOW
  }
  return { ...base, fingerprint: `fp-${base.id}`, ...over }
}

export function makeMemory(over: Partial<Memory> = {}): Memory {
  return {
    id: id(),
    characterId: 1,
    type: 'canon',
    content: 'Ayame cannot swim.',
    sourceSceneId: null,
    status: 'approved',
    createdAt: NOW,
    ...over
  }
}

function emptyStore(): FakeStore {
  return {
    worlds: [],
    characters: [],
    sprites: [],
    scenes: [],
    messages: [],
    memories: [],
    lore: [],
    personas: [],
    templates: [],
    notes: [],
    noteChat: [],
    suggestions: [],
    settings: { ...DEFAULT_SETTINGS },
    hub: {
      hubMode: false,
      publicationId: null,
      receipt: null,
      previousPublicationId: null,
      linkedFolder: ''
    },
    nextImportPath: 'worlds/hv/imported.png'
  }
}

// ---- installation --------------------------------------------------------

export function installFakeApi(seed: Partial<FakeStore> = {}): FakeApi {
  resetIds()
  const store: FakeStore = { ...emptyStore(), ...seed }
  const calls: [string, ...unknown[]][] = []
  const listeners = new Set<(e: StreamEvent) => void>()
  const streams = new Map<number, ChatStartParams>()
  const failures = new Map<string, { message: string; code: string }>()
  const deferred = new Set<string>()
  const gates = new Map<string, (() => void)[]>()
  let requestCounter = 0

  const api: FakeApi = {
    store,
    calls,
    streams,
    lastRequestId: 0,
    emit: (event) => listeners.forEach((l) => l(event)),
    chunk: (requestId, delta) => api.emit({ requestId, type: 'chunk', delta }),
    done: (requestId) => api.emit({ requestId, type: 'done' }),
    fail: (requestId, message) => api.emit({ requestId, type: 'error', message }),
    failNext: (channel, message, code = 'error') => failures.set(channel, { message, code }),
    defer: (channel) => deferred.add(channel),
    release: (channel) => {
      deferred.delete(channel)
      const waiting = gates.get(channel) ?? []
      gates.delete(channel)
      for (const resume of waiting) resume()
    },
    callsTo: (channel) => calls.filter(([c]) => c === channel).map(([, ...args]) => args)
  }

  const byId = <T extends { id: number }>(list: T[], value: number): T | null =>
    list.find((item) => item.id === value) ?? null

  /** Insert or update, returning the row id — mirrors the repositories. */
  function upsert<T extends { id: number }>(list: T[], draft: any, build: (draft: any) => T): number {
    if (draft.id) {
      const index = list.findIndex((item) => item.id === draft.id)
      if (index >= 0) list[index] = { ...list[index]!, ...draft } as T
      return draft.id
    }
    const created = build(draft)
    list.push(created)
    return created.id
  }

  const handlers: Record<string, (...args: any[]) => unknown> = {
    'worlds:list': () => store.worlds,
    'worlds:get': (wid: number) => byId(store.worlds, wid),
    'worlds:save': (draft: any) => upsert(store.worlds, draft, (d) => makeWorld(d)),
    'worlds:delete': (wid: number) => {
      store.worlds = store.worlds.filter((w) => w.id !== wid)
    },

    'characters:list': (wid: number) => store.characters.filter((c) => c.worldId === wid),
    'characters:get': (cid: number) => byId(store.characters, cid),
    'characters:save': (draft: any) => upsert(store.characters, draft, (d) => makeCharacter(d)),
    'characters:delete': (cid: number) => {
      store.characters = store.characters.filter((c) => c.id !== cid)
    },

    'sprites:list': (cid: number) => store.sprites.filter((s) => s.characterId === cid),
    'sprites:save': (draft: any) =>
      upsert(store.sprites, draft, (d) => ({
        id: id(),
        characterId: d.characterId,
        name: d.name,
        callSign: String(d.callSign).toLowerCase(),
        imagePath: d.imagePath,
        sortOrder: d.sortOrder ?? 0
      })),
    'sprites:delete': (sid: number) => {
      store.sprites = store.sprites.filter((s) => s.id !== sid)
    },

    'lore:list': (wid: number) => store.lore.filter((l) => l.worldId === wid),
    'lore:save': (draft: any) =>
      upsert(store.lore, draft, (d) => ({
        id: id(),
        worldId: d.worldId,
        title: d.title,
        content: d.content ?? '',
        keywords: d.keywords ?? [],
        alwaysInclude: !!d.alwaysInclude,
        hubId: null,
        publicationId: null,
        createdAt: NOW,
        updatedAt: NOW
      })),
    'lore:delete': (lid: number) => {
      store.lore = store.lore.filter((l) => l.id !== lid)
    },

    'personas:list': () => store.personas,
    'personas:save': (draft: any) =>
      upsert(store.personas, draft, (d) => ({
        id: id(),
        name: d.name,
        description: d.description ?? '',
        createdAt: NOW
      })),
    'personas:delete': (pid: number) => {
      store.personas = store.personas.filter((p) => p.id !== pid)
    },

    'scenes:list': (wid: number) => store.scenes.filter((s) => s.worldId === wid),
    'scenes:listAll': () => store.scenes,
    'scenes:get': (sid: number) => byId(store.scenes, sid),
    'scenes:save': (draft: any) => upsert(store.scenes, draft, (d) => makeScene(d)),
    'scenes:delete': (sid: number) => {
      store.scenes = store.scenes.filter((s) => s.id !== sid)
    },
    'scenes:setDisplayMode': (sid: number, mode: string | null) => {
      const scene = byId(store.scenes, sid)
      if (scene) scene.displayMode = mode as Scene['displayMode']
    },

    'messages:list': (sid: number) =>
      store.messages.filter((m) => m.sceneId === sid && !m.deletedAt),
    'messages:count': (sid: number) =>
      store.messages.filter((m) => m.sceneId === sid && !m.deletedAt).length,
    'messages:update': (mid: number, content: string) => {
      const message = byId(store.messages, mid)
      if (message) message.content = content
    },
    'messages:delete': (mid: number) => {
      const message = byId(store.messages, mid)
      if (message) message.deletedAt = NOW
    },

    'templates:list': (wid: number) => store.templates.filter((t) => t.worldId === wid),
    'templates:save': (draft: any) =>
      upsert(store.templates, draft, (d) => ({
        id: id(),
        worldId: d.worldId,
        name: d.name,
        premise: d.premise ?? '',
        tone: d.tone ?? '',
        timeOfDay: d.timeOfDay ?? '',
        relationshipStatus: d.relationshipStatus ?? '',
        mode: d.mode ?? 'roleplay',
        narratorEnabled: !!d.narratorEnabled,
        locationId: null,
        personaId: d.personaId ?? null,
        characterIds: d.characterIds ?? []
      })),
    'templates:delete': (tid: number) => {
      store.templates = store.templates.filter((t) => t.id !== tid)
    },

    'memories:list': (cid: number, options?: { status?: string }) =>
      store.memories.filter(
        (m) =>
          m.characterId === cid &&
          (!options?.status || options.status === 'any' || m.status === options.status)
      ),
    'memories:save': (draft: any) => upsert(store.memories, draft, (d) => makeMemory(d)),
    'memories:delete': (mid: number) => {
      store.memories = store.memories.filter((m) => m.id !== mid)
    },

    'chat:start': (params: ChatStartParams) => {
      const requestId = ++requestCounter
      streams.set(requestId, params)
      api.lastRequestId = requestId
      if (params.kind === 'reply' && params.userMessage) {
        store.messages.push(
          makeMessage({ sceneId: params.sceneId, role: 'user', content: params.userMessage })
        )
      }
      return requestId
    },
    'chat:cancel': () => undefined,
    'chat:summarize': () => 'A summary.',
    'chat:impersonate': () => 'I step closer.',
    'chat:suggestMemories': () => store.memories.filter((m) => m.status === 'pending'),
    'chat:promptDebug': () => ({
      sections: [{ label: 'System instructions', content: 'You are playing…' }],
      messages: [{ role: 'system', content: 'You are playing…' }]
    }),
    'chat:export': () => '/tmp/exports/scene_1.md',
    'chat:cancelOneShot': () => undefined,

    'notes:list': (wid: number) => store.notes.filter((n) => n.worldId === wid),
    'notes:get': (nid: number) => byId(store.notes, nid),
    'notes:save': (draft: any) => upsert(store.notes, draft, (d) => makeNote(d)),
    'notes:touch': () => undefined,
    'notes:duplicate': (nid: number) => {
      const source = byId(store.notes, nid)
      if (!source) return null
      const copy = makeNote({ ...source, id: id(), title: `${source.title} copy` })
      store.notes.push(copy)
      return copy
    },
    'notes:delete': (nid: number) => {
      store.notes = store.notes.filter((n) => n.id !== nid)
    },

    'notesChat:list': (wid: number) => store.noteChat.filter((m) => m.worldId === wid),
    'notesChat:deleteMessage': (mid: number) => {
      store.noteChat = store.noteChat.filter((m) => m.id !== mid)
    },
    'notesChat:clear': (wid: number) => {
      store.noteChat = store.noteChat.filter((m) => m.worldId !== wid)
    },
    'notesChat:suggestions': (mid: number) => store.suggestions.filter((s) => s.messageId === mid),

    'notes:pendingProposals': () => store.suggestions.filter((s) => s.status === 'pending'),
    'notes:approveSuggestion': (sid: number, edited: any) => {
      const suggestion = byId(store.suggestions, sid)
      if (suggestion) suggestion.status = 'approved'
      const note = suggestion?.targetNoteId ? byId(store.notes, suggestion.targetNoteId) : null
      if (note) {
        note.title = edited.title
        note.content = edited.content
        note.lifecycleStatus = 'canonical'
      }
      return note?.id ?? 0
    },
    'notes:rejectSuggestion': (sid: number) => {
      const suggestion = byId(store.suggestions, sid)
      if (suggestion) suggestion.status = 'rejected'
    },
    'notes:latestPromptUsage': () => ({}),
    'notes:contextPreview': (_wid: number, message: string) =>
      store.notes
        .filter((n) => n.contextMode !== 'excluded')
        .filter((n) => n.contextMode === 'always' || message.toLowerCase().includes(n.title.toLowerCase()))
        .map((n) => ({ noteId: n.id, title: n.title, reason: 'always included' })),
    'notes:linkReferences': (_wid: number, text: string) => text,

    'settings:get': () => store.settings,
    'settings:save': (values: Partial<AppSettings>) => {
      store.settings = { ...store.settings, ...values }
    },
    'provider:test': () => ({ latencyMs: 12, models: ['mock-model-7b', 'mock-model-13b'] }),
    'assets:importImage': () => store.nextImportPath,

    'hub:status': () => store.hub,
    'hub:stageZip': () => null,
    'hub:linkFolder': () => null,
    'hub:stageLinkedFolder': () => {
      throw new Error('No World Hub production folder is linked.')
    },
    'hub:checkForUpdate': () => {
      throw new Error('No World Hub production folder is linked.')
    },
    'hub:activate': () => store.hub,
    'hub:cancelStaged': () => undefined,
    'hub:rollback': () => store.hub,
    'hub:migrateScene': (sid: number) => {
      const scene = byId(store.scenes, sid)
      if (scene) scene.publicationId = store.hub.publicationId
    }
  }

  const bridge: RendererApi = {
    invoke: async (channel: string, ...args: unknown[]): Promise<IpcResult<any>> => {
      calls.push([channel, ...args])
      if (deferred.has(channel)) {
        await new Promise<void>((resume) => gates.set(channel, [...(gates.get(channel) ?? []), resume]))
      }
      const forced = failures.get(channel)
      if (forced) {
        failures.delete(channel)
        return { ok: false, code: forced.code, message: forced.message }
      }
      const handler = handlers[channel]
      if (!handler) return { ok: false, code: 'error', message: `No fake handler for ${channel}` }
      try {
        return { ok: true, value: handler(...args) }
      } catch (err) {
        return { ok: false, code: 'error', message: (err as Error).message }
      }
    },
    onStreamEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  } as RendererApi

  ;(window as unknown as { api: RendererApi }).api = bridge
  return api
}

import type {
  AppSettings,
  Character,
  CharacterDraft,
  CharacterSprite,
  ConnectionTest,
  DisplayMode,
  LoreDraft,
  LoreEntry,
  Memory,
  MemoryDraft,
  MemoryStatus,
  MemoryType,
  Message,
  NoteChatMessage,
  NoteSuggestion,
  Persona,
  PersonaDraft,
  Scene,
  SceneDraft,
  SceneTemplate,
  SceneTemplateDraft,
  SpriteDraft,
  World,
  WorldDraft,
  WorldNote,
  WorldNoteDraft
} from './types'

export type ChatStartParams =
  | {
      kind: 'reply'
      sceneId: number
      /** Persisted as the user's turn before generating, when non-empty. */
      userMessage?: string
      responderId?: number | null
      respondToLatest?: boolean
    }
  | { kind: 'continuation'; sceneId: number; messageId: number; partial: string }
  | {
      kind: 'notesChat'
      worldId: number
      /** Persisted first when given; omitted = regenerate from the latest user message. */
      userMessage?: string
      activeNoteId?: number | null
    }

export interface PromptDebugInfo {
  sections: { label: string; content: string }[]
  messages: { role: string; content: string }[]
}

export interface HubStatus {
  hubMode: boolean
  publicationId: string | null
  receipt: Record<string, any> | null
  previousPublicationId: string | null
  linkedFolder: string
}

export interface HubUpdatePreview {
  publicationId: string
  productionName: string
  productionRevision: number
  publishedAt: string
  addedWorlds: string[]
  addedCharacters: string[]
  updatedCharacters: string[]
  retiredCharacters: string[]
  loreDocuments: number
  pinnedScenes: number
  alreadyActive: boolean
}

/**
 * The single source of truth for the IPC surface. Every invokable method is a
 * key here; main registers handlers against it and the renderer client calls
 * through it, so the two sides cannot drift.
 *
 * The surface grows phase by phase — keep entries grouped by domain.
 */
export interface IpcMethods {
  'worlds:list': () => World[]
  'worlds:get': (id: number) => World | null
  'worlds:save': (draft: WorldDraft) => number
  'worlds:delete': (id: number) => void

  'characters:list': (worldId: number) => Character[]
  'characters:get': (id: number) => Character | null
  'characters:save': (draft: CharacterDraft) => number
  'characters:delete': (id: number) => void

  'sprites:list': (characterId: number) => CharacterSprite[]
  'sprites:save': (draft: SpriteDraft) => number
  'sprites:delete': (id: number) => void

  'lore:list': (worldId: number) => LoreEntry[]
  'lore:save': (draft: LoreDraft) => number
  'lore:delete': (id: number) => void

  'personas:list': () => Persona[]
  'personas:save': (draft: PersonaDraft) => number
  'personas:delete': (id: number) => void

  'scenes:list': (worldId: number) => Scene[]
  'scenes:listAll': () => Scene[]
  'scenes:get': (id: number) => Scene | null
  'scenes:save': (draft: SceneDraft) => number
  'scenes:delete': (id: number) => void
  'scenes:setDisplayMode': (id: number, mode: DisplayMode | null) => void

  'messages:list': (sceneId: number) => Message[]
  'messages:count': (sceneId: number) => number
  'messages:update': (id: number, content: string) => void
  'messages:delete': (id: number) => void

  'templates:list': (worldId: number) => SceneTemplate[]
  'templates:save': (draft: SceneTemplateDraft) => number
  'templates:delete': (id: number) => void

  'memories:list': (
    characterId: number,
    options?: { types?: MemoryType[]; status?: MemoryStatus | 'any' }
  ) => Memory[]
  'memories:save': (draft: MemoryDraft) => number
  'memories:delete': (id: number) => void

  'chat:start': (params: ChatStartParams) => number
  'chat:cancel': (requestId: number) => void
  /** Stops the scene's in-flight one-shot (summary, impersonation, memories). */
  'chat:cancelOneShot': (sceneId: number) => void
  'chat:summarize': (sceneId: number) => string
  'chat:impersonate': (sceneId: number, draft?: string) => string
  'chat:suggestMemories': (sceneId: number) => Memory[]
  'chat:promptDebug': (sceneId: number) => PromptDebugInfo
  /** Writes a Markdown transcript into the exports dir; returns the path. */
  'chat:export': (sceneId: number) => string

  'notes:list': (worldId: number) => (WorldNote & { fingerprint: string })[]
  'notes:get': (id: number) => WorldNote | null
  'notes:save': (draft: WorldNoteDraft) => number
  'notes:touch': (id: number) => void
  'notes:duplicate': (id: number) => WorldNote | null
  'notes:delete': (id: number) => void

  'notesChat:list': (worldId: number) => NoteChatMessage[]
  'notesChat:deleteMessage': (id: number) => void
  'notesChat:clear': (worldId: number) => void
  'notesChat:suggestions': (messageId: number) => NoteSuggestion[]

  'notes:pendingProposals': (worldId: number) => NoteSuggestion[]
  'notes:approveSuggestion': (
    suggestionId: number,
    edited: { title: string; content: string; category: string; contextMode: string; isPinned: boolean }
  ) => number
  'notes:rejectSuggestion': (suggestionId: number) => void
  'notes:latestPromptUsage': (worldId: number) => Record<number, { fingerprint: string; reason: string }>
  'notes:contextPreview': (
    worldId: number,
    currentMessage: string,
    activeNoteId: number | null
  ) => { noteId: number; title: string; reason: string }[]
  /** Renders assistant text with app-note:// links for unique note titles. */
  'notes:linkReferences': (worldId: number, text: string) => string

  'hub:status': () => HubStatus
  /** Opens a ZIP picker, stages + validates; null if the user cancelled. */
  'hub:stageZip': () => { stagedId: number; preview: HubUpdatePreview } | null
  /** Opens a directory picker and links a production folder; null if cancelled. */
  'hub:linkFolder': () => string | null
  'hub:stageLinkedFolder': () => { stagedId: number; preview: HubUpdatePreview }
  'hub:checkForUpdate': () => HubUpdatePreview
  'hub:activate': (stagedId: number) => HubStatus
  'hub:cancelStaged': (stagedId: number) => void
  'hub:rollback': () => HubStatus
  'hub:migrateScene': (sceneId: number) => void

  'settings:get': () => AppSettings
  'settings:save': (values: Partial<AppSettings>) => void

  /** Lists models at the configured (or provided) endpoint and measures latency. */
  'provider:test': (overrides?: Partial<AppSettings>) => ConnectionTest

  /**
   * Opens a native image picker and imports the chosen file into the media
   * store. Returns the media-relative path, or null if the user cancelled.
   */
  'assets:importImage': (target:
    | { kind: 'worldCover' | 'sessionBackground'; worldName: string }
    | { kind: 'characterImage'; worldName: string; characterName: string }) => string | null
}

export type IpcChannel = keyof IpcMethods

/** Serialized result envelope for invoke calls. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string }

/** Streaming events pushed from main (chat streaming arrives in a later phase). */
export interface StreamEvent {
  requestId: number
  type: 'chunk' | 'done' | 'error'
  delta?: string
  message?: string
}

export const STREAM_CHANNEL = 'stream:event'

/** The API shape the preload script exposes as window.api. */
export interface RendererApi {
  invoke: <K extends IpcChannel>(
    channel: K,
    ...args: Parameters<IpcMethods[K]>
  ) => Promise<IpcResult<ReturnType<IpcMethods[K]>>>
  onStreamEvent: (listener: (event: StreamEvent) => void) => () => void
}

declare global {
  interface Window {
    api: RendererApi
  }
}

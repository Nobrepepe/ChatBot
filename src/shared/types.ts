// Entity types shared between the main process and the renderer.
// These mirror the SQLite schema in src/main/db/migrations/001_init.sql.

export const SCENE_MODES = ['roleplay', 'interview', 'author'] as const
export type SceneMode = (typeof SCENE_MODES)[number]

export const MEMORY_TYPES = ['canon', 'relationship', 'session'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export const MEMORY_STATUSES = ['approved', 'pending'] as const
export type MemoryStatus = (typeof MEMORY_STATUSES)[number]

export const MESSAGE_ROLES = ['user', 'character', 'narrator', 'system-note'] as const
export type MessageRole = (typeof MESSAGE_ROLES)[number]

export const NOTE_CATEGORIES = ['Characters', 'Setting', 'Plot', 'Unsorted'] as const
export type NoteCategory = (typeof NOTE_CATEGORIES)[number]

export const NOTE_CONTEXT_MODES = ['always', 'relevant', 'excluded'] as const
export type NoteContextMode = (typeof NOTE_CONTEXT_MODES)[number]

export const NOTE_LIFECYCLE_STATUSES = ['canonical', 'proposed', 'rejected', 'superseded'] as const
export type NoteLifecycleStatus = (typeof NOTE_LIFECYCLE_STATUSES)[number]

export const NOTE_ACTION_TYPES = ['open', 'create', 'append', 'replace'] as const
export type NoteActionType = (typeof NOTE_ACTION_TYPES)[number]

export const SUGGESTION_STATUSES = ['pending', 'approved', 'rejected', 'superseded'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

export const DISPLAY_MODES = ['chat', 'vn'] as const
export type DisplayMode = (typeof DISPLAY_MODES)[number]

export interface World {
  id: number
  name: string
  genre: string
  tone: string
  summary: string
  settingDescription: string
  styleGuide: string
  coverImagePath: string
  sessionBackgroundPath: string
  hubId: string | null
  publicationId: string | null
  createdAt: string
  updatedAt: string
}

export interface Location {
  id: number
  worldId: number
  name: string
  description: string
  backgroundPath: string
  moodTags: string
  hubId: string | null
  publicationId: string | null
}

export interface Character {
  id: number
  worldId: number
  name: string
  nicknames: string
  age: string
  role: string
  summary: string
  appearance: string
  personality: string
  backstory: string
  behaviorRules: string
  voiceStyle: string
  relationshipToUser: string
  aiInstructions: string
  portraitPath: string
  tileImagePath: string
  hubId: string | null
  publicationId: string | null
  createdAt: string
  updatedAt: string
}

export interface CharacterSprite {
  id: number
  characterId: number
  name: string
  /** Bare, lowercase, no brackets — brackets exist only in the wire format. */
  callSign: string
  imagePath: string
  sortOrder: number
}

export interface Scene {
  id: number
  worldId: number
  locationId: number | null
  title: string
  premise: string
  tone: string
  timeOfDay: string
  relationshipStatus: string
  mode: SceneMode
  summary: string
  narratorEnabled: boolean
  personaId: number | null
  publicationId: string | null
  /** Per-scene display mode; null falls back to the global setting. */
  displayMode: DisplayMode | null
  characterIds: number[]
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: number
  sceneId: number
  role: MessageRole
  /** Structured speaker for character turns; null for user/narrator turns. */
  characterId: number | null
  /** Clean text: no {Name} prefix, no [emotion] tag. */
  content: string
  /** Bare call sign of the sprite the reply chose, or ''. */
  emotion: string
  deletedAt: string | null
  createdAt: string
}

export interface Memory {
  id: number
  characterId: number
  type: MemoryType
  content: string
  sourceSceneId: number | null
  status: MemoryStatus
  createdAt: string
}

export interface LoreEntry {
  id: number
  worldId: number
  title: string
  content: string
  keywords: string[]
  alwaysInclude: boolean
  hubId: string | null
  publicationId: string | null
  createdAt: string
  updatedAt: string
}

export interface Persona {
  id: number
  name: string
  description: string
  createdAt: string
}

export interface SceneTemplate {
  id: number
  worldId: number
  name: string
  premise: string
  tone: string
  timeOfDay: string
  relationshipStatus: string
  mode: SceneMode
  narratorEnabled: boolean
  locationId: number | null
  personaId: number | null
  characterIds: number[]
}

export interface WorldNote {
  id: number
  worldId: number
  title: string
  content: string
  category: NoteCategory
  isPinned: boolean
  contextMode: NoteContextMode
  lastOpenedAt: string | null
  lifecycleStatus: NoteLifecycleStatus
  workspaceSessionId: number | null
  proposalMessageId: number | null
  createdAt: string
  updatedAt: string
}

export interface NoteChatMessage {
  id: number
  worldId: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface NoteSuggestion {
  id: number
  messageId: number
  ordinal: number
  actionType: NoteActionType
  targetNoteId: number | null
  payload: Record<string, unknown>
  status: SuggestionStatus
}

export interface WorldDraft {
  id?: number | null
  name: string
  genre?: string
  tone?: string
  summary?: string
  settingDescription?: string
  styleGuide?: string
  coverImagePath?: string
  sessionBackgroundPath?: string
}

/** All settings are stored as strings in the settings table. */
export interface AppSettings {
  baseUrl: string
  apiKey: string
  model: string
  temperature: string
  topP: string
  maxTokens: string
  streaming: string
  historyLimit: string
  /** Characters of lore text sent per prompt; '0' sends every match. */
  loreBudget: string
  displayMode: string
  systemPrompt: string
  reduceMotion: string
  textScale: string
}

export interface CharacterDraft {
  id?: number | null
  worldId: number
  name: string
  nicknames?: string
  age?: string
  role?: string
  summary?: string
  appearance?: string
  personality?: string
  backstory?: string
  behaviorRules?: string
  voiceStyle?: string
  relationshipToUser?: string
  aiInstructions?: string
  portraitPath?: string
  tileImagePath?: string
}

export interface SpriteDraft {
  id?: number | null
  characterId: number
  name: string
  callSign: string
  imagePath: string
  sortOrder?: number
}

export interface LoreDraft {
  id?: number | null
  worldId: number
  title: string
  content?: string
  keywords?: string[]
  alwaysInclude?: boolean
}

export interface PersonaDraft {
  id?: number | null
  name: string
  description?: string
}

export interface SceneDraft {
  id?: number | null
  worldId: number
  title?: string
  premise?: string
  tone?: string
  timeOfDay?: string
  relationshipStatus?: string
  mode?: SceneMode
  narratorEnabled?: boolean
  personaId?: number | null
  characterIds?: number[]
}

export interface SceneTemplateDraft {
  id?: number | null
  worldId: number
  name: string
  premise?: string
  tone?: string
  timeOfDay?: string
  relationshipStatus?: string
  mode?: SceneMode
  narratorEnabled?: boolean
  locationId?: number | null
  personaId?: number | null
  characterIds?: number[]
}

export interface MemoryDraft {
  id?: number | null
  characterId: number
  type: MemoryType
  content: string
  sourceSceneId?: number | null
  status?: MemoryStatus
}

export interface WorldNoteDraft {
  id?: number | null
  worldId: number
  title: string
  content?: string
  category?: string
  isPinned?: boolean
  contextMode?: string
  lifecycleStatus?: NoteLifecycleStatus
  workspaceSessionId?: number | null
  proposalMessageId?: number | null
}

export interface ConnectionTest {
  latencyMs: number
  models: string[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: '',
  temperature: '0.8',
  topP: '0.95',
  maxTokens: '1024',
  streaming: '1',
  historyLimit: '30',
  loreBudget: '6000',
  displayMode: 'chat',
  systemPrompt: '',
  reduceMotion: '0',
  textScale: '1.0'
}

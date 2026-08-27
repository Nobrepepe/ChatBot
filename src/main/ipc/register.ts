import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { IpcChannel, IpcMethods, IpcResult } from '@shared/ipc'
import * as worlds from '../db/repo/worlds'
import * as characters from '../db/repo/characters'
import * as lore from '../db/repo/lore'
import * as personas from '../db/repo/personas'
import * as scenes from '../db/repo/scenes'
import * as messages from '../db/repo/messages'
import * as templates from '../db/repo/templates'
import * as memories from '../db/repo/memories'
import * as settings from '../db/repo/settings'
import * as notes from '../db/repo/notes'
import * as provider from '../providers/openaiCompat'
import * as assets from '../services/assetService'
import * as chat from '../services/chatService'
import * as notesWorkspace from '../services/notesWorkspace'
import * as hub from '../worldhub/consumerService'
import { noteFingerprint } from '../services/notesService'
import { cancelChatStream, startChatStream } from './chatStream'
import { cancelSceneOneShot, runSceneOneShot } from './oneShot'

/**
 * Registers one ipcMain.handle per IpcMethods entry. Handlers may be sync or
 * async; thrown errors are serialized so their user-facing message survives
 * the boundary (ProviderError/PackageError keep their code).
 */
function handle<K extends IpcChannel>(
  channel: K,
  fn: (
    ...args: Parameters<IpcMethods[K]>
  ) => ReturnType<IpcMethods[K]> | Promise<ReturnType<IpcMethods[K]>>
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<unknown>> => {
    try {
      const value = await fn(...(args as Parameters<IpcMethods[K]>))
      return { ok: true, value }
    } catch (err) {
      const error = err as Error & { code?: string }
      return {
        ok: false,
        code: error.code ?? 'error',
        message: error.message || 'Something went wrong.'
      }
    }
  })
}

async function pickImage(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = win
    ? await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      })
    : await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      })
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
}

export function registerIpcHandlers(): void {
  handle('worlds:list', worlds.listWorlds)
  handle('worlds:get', worlds.getWorld)
  handle('worlds:save', worlds.saveWorld)
  handle('worlds:delete', worlds.deleteWorld)

  handle('characters:list', characters.listCharacters)
  handle('characters:get', characters.getCharacter)
  handle('characters:save', characters.saveCharacter)
  handle('characters:delete', characters.deleteCharacter)

  handle('sprites:list', characters.listCharacterSprites)
  handle('sprites:save', characters.saveCharacterSprite)
  handle('sprites:delete', characters.deleteCharacterSprite)

  handle('lore:list', lore.listLoreEntries)
  handle('lore:save', lore.saveLoreEntry)
  handle('lore:delete', lore.deleteLoreEntry)

  handle('personas:list', personas.listPersonas)
  handle('personas:save', personas.savePersona)
  handle('personas:delete', personas.deletePersona)

  handle('scenes:list', scenes.listScenes)
  handle('scenes:listAll', scenes.listAllScenes)
  handle('scenes:get', scenes.getScene)
  handle('scenes:save', scenes.saveScene)
  handle('scenes:delete', scenes.deleteScene)
  handle('scenes:setDisplayMode', scenes.setSceneDisplayMode)
  handle('scenes:inviteCharacters', (sceneId, characterIds) => {
    for (const id of scenes.inviteCharacters(sceneId, characterIds)) {
      const character = characters.getCharacter(id)
      if (!character) continue
      // Display-only: system notes are never sent to the model or exported.
      messages.addMessage({
        sceneId,
        role: 'system-note',
        characterId: id,
        content: `${character.name} joins the scene.`
      })
    }
  })

  handle('messages:list', (sceneId) => messages.listMessages(sceneId))
  handle('messages:count', messages.countMessages)
  handle('messages:update', messages.updateMessage)
  handle('messages:delete', messages.deleteMessage)

  handle('templates:list', templates.listSceneTemplates)
  handle('templates:save', templates.saveSceneTemplate)
  handle('templates:delete', templates.deleteSceneTemplate)

  handle('memories:list', (characterId, options) => memories.listMemories(characterId, options))
  handle('memories:save', memories.saveMemory)
  handle('memories:delete', memories.deleteMemory)

  handle('memories:proposalsForScene', (sceneId) => memories.listSceneProposals(sceneId))
  handle('memories:proposalsForCharacter', (characterId) =>
    memories.listCharacterProposals(characterId)
  )
  handle('memories:approveSuggestion', (id, edited) =>
    memories.approveMemorySuggestion(id, edited.content, edited.type)
  )
  handle('memories:rejectSuggestion', (id) => memories.setMemorySuggestionStatus(id, 'rejected'))

  handle('chat:start', startChatStream)
  handle('chat:cancel', cancelChatStream)
  handle('chat:cancelOneShot', cancelSceneOneShot)
  // One slot per scene, so a second click cannot stack another full prompt.
  handle('chat:summarize', (sceneId) =>
    runSceneOneShot(sceneId, (signal) => chat.summarize(sceneId, signal))
  )
  handle('chat:impersonate', (sceneId, draft) =>
    runSceneOneShot(sceneId, (signal) => chat.impersonate(sceneId, draft, signal))
  )
  handle('chat:suggestMemories', (sceneId) =>
    runSceneOneShot(sceneId, (signal) => chat.proposeMemories(sceneId, signal))
  )
  handle('chat:promptDebug', (sceneId) => {
    const result = chat.build(sceneId)
    return { sections: result.built.sections, messages: result.built.messages }
  })
  handle('chat:export', (sceneId) => {
    const path = chat.exportScene(sceneId)
    shell.showItemInFolder(path)
    return path
  })

  handle('notes:list', (worldId) =>
    notes.listWorldNotes(worldId).map((n) => ({ ...n, fingerprint: noteFingerprint(n) }))
  )
  handle('notes:get', notes.getWorldNote)
  handle('notes:save', notes.saveWorldNote)
  handle('notes:touch', notes.touchWorldNote)
  handle('notes:duplicate', notes.duplicateWorldNote)
  handle('notes:delete', notes.deleteWorldNote)

  handle('notesChat:list', notes.listNoteChatMessages)
  handle('notesChat:deleteMessage', notes.deleteNoteChatMessage)
  handle('notesChat:clear', notes.clearNoteChat)
  handle('notesChat:suggestions', notes.listNoteSuggestions)

  handle('notes:pendingProposals', notes.listPendingNoteSuggestions)
  handle('notes:approveSuggestion', notesWorkspace.approveSuggestion)
  handle('notes:rejectSuggestion', (id) => notes.setNoteSuggestionStatus(id, 'rejected'))
  handle('notes:latestPromptUsage', notes.latestNotePromptUsage)
  handle('notes:contextPreview', notesWorkspace.contextPreview)
  handle('notes:linkReferences', (worldId, text) =>
    notesWorkspace.linkNoteReferences(text, notes.listWorldNotes(worldId))
  )

  handle('hub:status', hub.status)
  handle('hub:stageZip', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'World Hub publication', extensions: ['zip'] }]
        })
      : { canceled: true, filePaths: [] as string[] }
    if (result.canceled || !result.filePaths[0]) return null
    const staged = await hub.stageZip(result.filePaths[0])
    return { stagedId: hub.holdStaged(staged), preview: hub.preview(staged) }
  })
  handle('hub:linkFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : { canceled: true, filePaths: [] as string[] }
    if (result.canceled || !result.filePaths[0]) return null
    hub.linkFolder(result.filePaths[0])
    return result.filePaths[0]
  })
  handle('hub:stageLinkedFolder', () => {
    const staged = hub.stageLinkedFolder()
    return { stagedId: hub.holdStaged(staged), preview: hub.preview(staged) }
  })
  handle('hub:checkForUpdate', hub.checkForUpdate)
  handle('hub:activate', (stagedId) => hub.activate(hub.takeStaged(stagedId)))
  handle('hub:cancelStaged', (stagedId) => hub.cleanupStaged(hub.takeStaged(stagedId)))
  handle('hub:rollback', hub.rollback)

  handle('settings:get', settings.getSettings)
  handle('settings:save', settings.saveSettings)

  handle('provider:test', (overrides) =>
    provider.testConnection({ ...settings.getSettings(), ...overrides })
  )

  handle('assets:importImage', async (target) => {
    const source = await pickImage()
    if (!source) return null
    if (target.kind === 'characterImage') {
      return assets.importCharacterImage(source, target.worldName, target.characterName)
    }
    if (target.kind === 'worldCover') return assets.importWorldCover(source, target.worldName)
    return assets.importSessionBackground(source, target.worldName)
  })
}

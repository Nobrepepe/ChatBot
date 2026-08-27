import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerMediaSchemeAsPrivileged, registerMediaProtocolHandler } from './mediaProtocol'
import { registerIpcHandlers } from './ipc/register'
import { getDb } from './db/connection'
import {
  DEFAULT_WINDOW_STATE,
  MIN_HEIGHT,
  MIN_WIDTH,
  parseWindowState,
  placeWindow,
  type WindowState
} from './windowState'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Launching `electron out/main/index.js` directly would default the app name to
// "Electron"; pin the identity so dev and packaged builds share one data dir.
app.setName('character-chat')
app.setPath('userData', join(app.getPath('appData'), 'character-chat'))

registerMediaSchemeAsPrivileged()

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/**
 * Restores the saved geometry, fitted to the displays attached right now — the
 * monitor the window was last left on may be gone, and a window restored onto
 * a display that no longer exists never appears at all.
 */
function readWindowState(): WindowState {
  let saved: WindowState | null = null
  try {
    saved = parseWindowState(readFileSync(windowStatePath(), 'utf8'))
  } catch {
    /* first run */
  }
  const primary = screen.getPrimaryDisplay()
  const areas = [
    primary.workArea,
    ...screen
      .getAllDisplays()
      .filter((display) => display.id !== primary.id)
      .map((display) => display.workArea)
  ]
  return placeWindow(saved ?? DEFAULT_WINDOW_STATE, areas)
}

function createWindow(): void {
  const state = readWindowState()
  const win = new BrowserWindow({
    title: 'Character Chat',
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#121014',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Maximised, minimised and full-screen bounds describe the screen rather than
  // the window the user arranged, so they are never the geometry worth saving.
  win.on('close', () => {
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
      const bounds = win.getBounds()
      try {
        writeFileSync(windowStatePath(), JSON.stringify(bounds))
      } catch {
        /* best effort */
      }
    }
  })

  // Dev-only verification harness: CHATBOT_SCREENSHOT=/path.png [CHATBOT_ROUTE=#/world/1]
  // captures the window after load and exits, so the UI can be checked headlessly.
  const screenshotPath = process.env['CHATBOT_SCREENSHOT']
  if (screenshotPath) {
    win.webContents.once('did-finish-load', () => {
      const route = process.env['CHATBOT_ROUTE']
      if (route) {
        win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(route)}`)
      }
      const scriptFile = process.env['CHATBOT_SCRIPT_FILE']
      if (scriptFile) {
        setTimeout(async () => {
          const { readFileSync } = await import('node:fs')
          await win.webContents.executeJavaScript(readFileSync(scriptFile, 'utf8'))
        }, 800)
      }
      setTimeout(async () => {
        const image = await win.webContents.capturePage()
        const { writeFileSync } = await import('node:fs')
        writeFileSync(screenshotPath, image.toPNG())
        app.quit()
      }, Number(process.env['CHATBOT_SCREENSHOT_DELAY'] ?? 1400))
    })
  }

  // Every screen is a hash route inside the one page, so the window has no
  // business navigating anywhere. Without this, a file dropped on the window —
  // or a link that escapes the handler below — replaces the whole app with it,
  // and the only way back is to restart.
  win.webContents.on('will-navigate', (event, url) => {
    const document = (address: string): string => address.split('#')[0]!
    if (document(url) !== document(win.webContents.getURL())) event.preventDefault()
  })

  // External links open in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerMediaProtocolHandler()
  getDb() // open + migrate before the first window asks for data
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

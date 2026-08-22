import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { registerMediaSchemeAsPrivileged, registerMediaProtocolHandler } from './mediaProtocol'
import { registerIpcHandlers } from './ipc/register'
import { getDb } from './db/connection'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Launching `electron out/main/index.js` directly would default the app name to
// "Electron"; pin the identity so dev and packaged builds share one data dir.
app.setName('character-chat')
app.setPath('userData', join(app.getPath('appData'), 'character-chat'))

registerMediaSchemeAsPrivileged()

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function readWindowState(): WindowState {
  try {
    const raw = JSON.parse(readFileSync(windowStatePath(), 'utf8')) as WindowState
    if (raw.width >= 960 && raw.height >= 640) return raw
  } catch {
    /* first run */
  }
  return { width: 1280, height: 820 }
}

function createWindow(): void {
  const state = readWindowState()
  const win = new BrowserWindow({
    title: 'Character Chat',
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
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

  win.on('close', () => {
    if (!win.isMaximized() && !win.isMinimized()) {
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

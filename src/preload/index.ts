import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RendererApi, StreamEvent } from '@shared/ipc'
import { STREAM_CHANNEL } from '@shared/ipc'

const api: RendererApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onStreamEvent: (listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: StreamEvent): void => listener(payload)
    ipcRenderer.on(STREAM_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(STREAM_CHANNEL, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)

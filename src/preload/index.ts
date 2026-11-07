import { contextBridge, ipcRenderer } from 'electron'
import type { ApiEvent, ApiResult } from '../shared/api'

const bridge = {
  call: (method: string, args: unknown[]): Promise<ApiResult<unknown>> => ipcRenderer.invoke('api', method, args),
  on: (cb: (e: ApiEvent) => void): (() => void) => {
    const l = (_e: unknown, ev: ApiEvent): void => cb(ev)
    ipcRenderer.on('api-event', l)
    return () => ipcRenderer.removeListener('api-event', l)
  }
}

export type Bridge = typeof bridge

contextBridge.exposeInMainWorld('kotkod', bridge)

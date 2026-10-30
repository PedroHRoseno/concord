import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

interface QuickShareSettings {
  sourceId: string
  sourceName: string
  audioMode: 'none' | 'system' | 'window' | 'device'
  audioDeviceId: string
  resolution: '720p' | '1080p' | '1440p' | 'native'
  fps: 30 | 60
  maxBitrate: number
  audioBitrate: number
  contentHint: 'motion' | 'detail'
}

let audioPort: MessagePort | null = null

const api = {
  getDesktopSources: (): Promise<
    Array<{
      id: string
      name: string
      thumbnail: string
      appIcon: string | null
      displayId: string
    }>
  > => ipcRenderer.invoke('sources:list'),
  prepareCapture: (options: {
    sourceId: string
    shareAudio: boolean
    loopbackWithScreen?: boolean
  }): Promise<boolean> => ipcRenderer.invoke('capture:prepare', options),
  setCaptureActive: (active: boolean): Promise<void> => ipcRenderer.invoke('capture:set-active', active),
  getMicrophoneAccess: (): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'> =>
    ipcRenderer.invoke('audio:microphone-access'),
  connectAudioLoopback: (onChunk: (bytes: Uint8Array) => void): void => {
    audioPort?.close()
    const { port1, port2 } = new MessageChannel()
    audioPort = port2
    port2.onmessage = (event: MessageEvent<Uint8Array>) => {
      const bytes = event.data
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2) return
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      onChunk(copy)
    }
    port2.start()
    ipcRenderer.postMessage('audio-loopback-port', null, [port1])
  },
  startAudioLoopback: (
    sourceId: string
  ): Promise<{ ok: boolean; isolated: boolean; pid: number | null }> => ipcRenderer.invoke('audio-loopback-start', sourceId),
  stopAudioLoopback: (): Promise<void> => {
    audioPort?.close()
    audioPort = null
    return ipcRenderer.invoke('audio-loopback-stop')
  },
  getOsUsername: (): Promise<string> => ipcRenderer.invoke('os:username'),
  getHotkey: (): Promise<string> => ipcRenderer.invoke('hotkey:get'),
  setHotkey: (accelerator: string): Promise<boolean> => ipcRenderer.invoke('hotkey:set', accelerator),
  onHotkey: (listener: (accelerator: string) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, accelerator: string): void => listener(accelerator)
    ipcRenderer.on('hotkey:changed', wrapped)
    return () => ipcRenderer.removeListener('hotkey:changed', wrapped)
  },
  onOpenShare: (listener: () => void): (() => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on('share:open', wrapped)
    return () => ipcRenderer.removeListener('share:open', wrapped)
  },
  onQuickShareStart: (listener: (settings: QuickShareSettings) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, settings: QuickShareSettings): void => listener(settings)
    ipcRenderer.on('share:start', wrapped)
    return () => ipcRenderer.removeListener('share:start', wrapped)
  },
  onQuickShareStop: (listener: () => void): (() => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on('share:stop', wrapped)
    return () => ipcRenderer.removeListener('share:stop', wrapped)
  },
  setRoomState: (state: { inRoom: boolean; sharing: boolean }): Promise<void> => ipcRenderer.invoke('room:state', state),
  getRoomState: (): Promise<{ inRoom: boolean; sharing: boolean }> => ipcRenderer.invoke('picker:room-state'),
  confirmQuickShare: (settings: QuickShareSettings): Promise<void> => ipcRenderer.invoke('picker:confirm', settings),
  stopQuickShare: (): Promise<void> => ipcRenderer.invoke('picker:stop'),
  cancelQuickShare: (): Promise<void> => ipcRenderer.invoke('picker:cancel'),
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  onMaximized: (listener: (maximized: boolean) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, maximized: boolean): void => listener(maximized)
    ipcRenderer.on('window:maximized', wrapped)
    return () => ipcRenderer.removeListener('window:maximized', wrapped)
  },
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (listener: (percent: number) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, percent: number): void => listener(percent)
    ipcRenderer.on('update:progress', wrapped)
    return () => ipcRenderer.removeListener('update:progress', wrapped)
  },
  onUpdateReady: (listener: () => void): (() => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on('update:ready', wrapped)
    return () => ipcRenderer.removeListener('update:ready', wrapped)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

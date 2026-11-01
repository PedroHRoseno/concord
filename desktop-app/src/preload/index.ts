import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

interface QuickShareSettings {
  sourceId: string
  sourceName: string
  audioMode: 'none' | 'system' | 'window' | 'device' | 'tab'
  audioDeviceId: string
  resolution: '720p' | '1080p' | '1440p' | 'native'
  fps: 30 | 60
  maxBitrate: number
  audioBitrate: number
  contentHint: 'motion' | 'detail'
}

interface UpdateStatus {
  phase: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'ready' | 'error'
  current?: string
  version?: string
  notes?: string
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  message?: string
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
    nativePicker?: boolean
  }): Promise<boolean> => ipcRenderer.invoke('capture:prepare', options),
  setCaptureActive: (active: boolean): Promise<void> => ipcRenderer.invoke('capture:set-active', active),
  restoreCapture: (): Promise<void> => ipcRenderer.invoke('capture:restore'),
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
  setDiscordClient: (clientId: string): Promise<void> => ipcRenderer.invoke('discord:client', clientId),
  setDiscordPresence: (presence: {
    inRoom: boolean
    roomName: string
    sharing: boolean
    sourceName: string
  }): Promise<void> => ipcRenderer.invoke('discord:presence', presence),
  getRoomState: (): Promise<{ inRoom: boolean; sharing: boolean }> => ipcRenderer.invoke('picker:room-state'),
  confirmQuickShare: (settings: QuickShareSettings): Promise<void> => ipcRenderer.invoke('picker:confirm', settings),
  stopQuickShare: (): Promise<void> => ipcRenderer.invoke('picker:stop'),
  cancelQuickShare: (): Promise<void> => ipcRenderer.invoke('picker:cancel'),
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  setWindowFullscreen: (value: boolean): Promise<boolean> => ipcRenderer.invoke('window:set-fullscreen', value),
  onMaximized: (listener: (maximized: boolean) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, maximized: boolean): void => listener(maximized)
    ipcRenderer.on('window:maximized', wrapped)
    return () => ipcRenderer.removeListener('window:maximized', wrapped)
  },
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  startDownload: (): void => {
    ipcRenderer.send('start-download')
  },
  installUpdate: (): void => {
    ipcRenderer.send('install-update')
  },
  onUpdateStatus: (listener: (status: UpdateStatus) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, status: UpdateStatus): void => listener(status)
    ipcRenderer.on('update:status', wrapped)
    return () => ipcRenderer.removeListener('update:status', wrapped)
  },
  onUpdateAvailable: (listener: (info: { version: string; notes: string; current: string }) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, info: { version: string; notes: string; current: string }): void => listener(info)
    ipcRenderer.on('update-available', wrapped)
    return () => ipcRenderer.removeListener('update-available', wrapped)
  },
  onUpdateNotAvailable: (listener: (info: { current: string }) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, info: { current: string }): void => listener(info)
    ipcRenderer.on('update-not-available', wrapped)
    return () => ipcRenderer.removeListener('update-not-available', wrapped)
  },
  onDownloadProgress: (
    listener: (progress: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }) => void
  ): (() => void) => {
    const wrapped = (
      _event: IpcRendererEvent,
      progress: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }
    ): void => listener(progress)
    ipcRenderer.on('download-progress', wrapped)
    return () => ipcRenderer.removeListener('download-progress', wrapped)
  },
  onUpdateDownloaded: (listener: (info: { version: string }) => void): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, info: { version: string }): void => listener(info)
    ipcRenderer.on('update-downloaded', wrapped)
    return () => ipcRenderer.removeListener('update-downloaded', wrapped)
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)

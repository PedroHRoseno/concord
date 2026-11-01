export interface DesktopSourceInfo {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
  displayId: string
}

export interface CapturePrepareOptions {
  sourceId: string
  shareAudio: boolean
  loopbackWithScreen?: boolean
  nativePicker?: boolean
}

export interface QuickShareSettings {
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

export interface ElectronBridge {
  getDesktopSources: () => Promise<DesktopSourceInfo[]>
  prepareCapture: (options: CapturePrepareOptions) => Promise<boolean>
  setCaptureActive: (active: boolean) => Promise<void>
  restoreCapture: () => Promise<void>
  getMicrophoneAccess: () => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  connectAudioLoopback: (onChunk: (bytes: Uint8Array) => void) => void
  startAudioLoopback: (sourceId: string) => Promise<{ ok: boolean; isolated: boolean; pid: number | null }>
  stopAudioLoopback: () => Promise<void>
  getOsUsername: () => Promise<string>
  getHotkey: () => Promise<string>
  setHotkey: (accelerator: string) => Promise<boolean>
  onHotkey: (listener: (accelerator: string) => void) => () => void
  onOpenShare: (listener: () => void) => () => void
  onQuickShareStart: (listener: (settings: QuickShareSettings) => void) => () => void
  onQuickShareStop: (listener: () => void) => () => void
  setRoomState: (state: { inRoom: boolean; sharing: boolean }) => Promise<void>
  setDiscordClient: (clientId: string) => Promise<void>
  setDiscordPresence: (presence: { inRoom: boolean; roomName: string; sharing: boolean; sourceName: string }) => Promise<void>
  getRoomState: () => Promise<{ inRoom: boolean; sharing: boolean }>
  confirmQuickShare: (settings: QuickShareSettings) => Promise<void>
  stopQuickShare: () => Promise<void>
  cancelQuickShare: () => Promise<void>
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  setWindowFullscreen: (value: boolean) => Promise<boolean>
  onMaximized: (listener: (maximized: boolean) => void) => () => void
  getVersion: () => Promise<string>
  checkForUpdates: () => Promise<void>
  startDownload: () => void
  installUpdate: () => void
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void
  onUpdateAvailable: (listener: (info: { version: string; notes: string; current: string }) => void) => () => void
  onUpdateNotAvailable: (listener: (info: { current: string }) => void) => () => void
  onDownloadProgress: (
    listener: (progress: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number }) => void
  ) => () => void
  onUpdateDownloaded: (listener: (info: { version: string }) => void) => () => void
}

export interface UpdateStatus {
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

declare global {
  interface Window {
    electronAPI?: ElectronBridge
  }
}

export {}

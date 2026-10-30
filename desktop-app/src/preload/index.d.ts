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
}

export interface QuickShareSettings {
  sourceId: string
  sourceName: string
  audioMode: 'none' | 'app' | 'device'
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
  getMicrophoneAccess: () => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  startProcessAudio: (sourceId: string) => Promise<boolean>
  stopProcessAudio: () => Promise<void>
  onProcessPcm: (listener: (bytes: Uint8Array) => void) => () => void
  getHotkey: () => Promise<string>
  setHotkey: (accelerator: string) => Promise<boolean>
  onHotkey: (listener: (accelerator: string) => void) => () => void
  onOpenShare: (listener: () => void) => () => void
  onQuickShareStart: (listener: (settings: QuickShareSettings) => void) => () => void
  onQuickShareStop: (listener: () => void) => () => void
  setRoomState: (state: { inRoom: boolean; sharing: boolean }) => Promise<void>
  getRoomState: () => Promise<{ inRoom: boolean; sharing: boolean }>
  confirmQuickShare: (settings: QuickShareSettings) => Promise<void>
  stopQuickShare: () => Promise<void>
  cancelQuickShare: () => Promise<void>
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximized: (listener: (maximized: boolean) => void) => () => void
  getVersion: () => Promise<string>
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateProgress: (listener: (percent: number) => void) => () => void
  onUpdateReady: (listener: () => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge
  }
}

export {}

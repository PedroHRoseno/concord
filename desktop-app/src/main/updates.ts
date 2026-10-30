import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'

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

function notesOf(value: UpdateInfo['releaseNotes']): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      const note = typeof item.note === 'string' ? item.note.trim() : ''
      const version = typeof item.version === 'string' ? item.version.trim() : ''
      return [version, note].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

export function registerUpdates(): void {
  let pendingVersion = ''
  let pendingNotes = ''

  const send = (status: UpdateStatus): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:status', status)
    }
  }

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      send({ phase: 'current', current: app.getVersion() })
      return
    }
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      send({
        phase: 'error',
        current: app.getVersion(),
        message: error instanceof Error ? error.message : 'Não foi possível procurar atualizações.'
      })
    }
  })
  ipcMain.handle('update:download', async () => {
    if (!app.isPackaged) return
    await autoUpdater.downloadUpdate()
  })
  ipcMain.handle('update:install', () => {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall()
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.on('checking-for-update', () => {
    send({ phase: 'checking', current: app.getVersion() })
  })
  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version
    pendingNotes = notesOf(info.releaseNotes)
    send({ phase: 'available', current: app.getVersion(), version: info.version, notes: pendingNotes })
  })
  autoUpdater.on('update-not-available', () => {
    pendingVersion = ''
    pendingNotes = ''
    send({ phase: 'current', current: app.getVersion() })
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    send({
      phase: 'downloading',
      current: app.getVersion(),
      version: pendingVersion,
      notes: pendingNotes,
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    send({
      phase: 'ready',
      current: app.getVersion(),
      version: info.version || pendingVersion,
      notes: pendingNotes
    })
  })
  autoUpdater.on('error', (error) => {
    console.warn('Atualização indisponível.', error)
    send({
      phase: 'error',
      current: app.getVersion(),
      version: pendingVersion || undefined,
      message: error instanceof Error ? error.message : 'Não foi possível atualizar.'
    })
  })
  void autoUpdater.checkForUpdates().catch((error) => {
    console.warn('Não foi possível procurar atualizações.', error)
  })
}

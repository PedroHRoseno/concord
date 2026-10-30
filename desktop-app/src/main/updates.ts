import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'

export function registerUpdates(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return
    await autoUpdater.checkForUpdates()
  })
  ipcMain.handle('update:install', () => {
    if (!app.isPackaged) return
    autoUpdater.quitAndInstall()
  })

  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.on('download-progress', (progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:progress', progress.percent)
    }
  })
  autoUpdater.on('update-downloaded', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('update:ready')
    }
  })
  autoUpdater.on('error', (error) => {
    console.warn('Atualização indisponível.', error)
  })
  void autoUpdater.checkForUpdates().catch((error) => {
    console.warn('Não foi possível procurar atualizações.', error)
  })
}

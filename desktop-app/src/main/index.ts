import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron'
import os from 'node:os'
import { join } from 'path'
import { registerCapture } from './capture'
import { registerHotkey } from './hotkey'
import { resourcePath } from './paths'
import { registerAudioLoopback } from './audioLoopback'
import { registerDiscord } from './discord'
import { registerUpdates } from './updates'

app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,VaapiIgnoreDriverChecks')

if (process.platform === 'win32') app.setAppUserModelId('com.concord.app')

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let pickerWindow: BrowserWindow | null = null
let isQuiting = false
let roomState = { inRoom: false, sharing: false }

function appIcon() {
  const icon = nativeImage.createFromPath(resourcePath('icon.png'))
  return icon.isEmpty() ? nativeImage.createEmpty() : icon
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function loadRenderer(win: BrowserWindow, search?: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    if (search) url.search = search
    void win.loadURL(url.toString())
    return
  }
  void win.loadFile(join(__dirname, '../renderer/index.html'), search ? { search: `?${search}` } : undefined)
}

function wireMaximized(win: BrowserWindow): void {
  const publish = (): void => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized())
  }
  win.on('maximize', publish)
  win.on('unmaximize', publish)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    thickFrame: true,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    title: 'Concord',
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  win.webContents.setBackgroundThrottling(false)
  wireMaximized(win)
  win.on('ready-to-show', () => {
    if (!mainWindow) mainWindow = win
    win.show()
  })
  win.on('close', (event) => {
    if (isQuiting || win !== mainWindow) return
    event.preventDefault()
    win.hide()
  })

  loadRenderer(win)
  if (!mainWindow) mainWindow = win
  return win
}

function closePicker(): void {
  const picker = pickerWindow
  pickerWindow = null
  if (picker && !picker.isDestroyed()) picker.close()
}

function openPicker(): void {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    showWindow(pickerWindow)
    return
  }
  const picker = new BrowserWindow({
    width: 680,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#313338',
    autoHideMenuBar: true,
    title: 'Compartilhar tela',
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  pickerWindow = picker
  picker.on('ready-to-show', () => picker.show())
  picker.on('closed', () => {
    if (pickerWindow === picker) pickerWindow = null
  })
  loadRenderer(picker, 'view=picker')
}

function openShare(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const background = !win.isVisible() || win.isMinimized()
  if (roomState.inRoom && background) {
    openPicker()
    return
  }
  showWindow(win)
  win.webContents.send('share:open')
}

function rebuildTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Concord', click: () => mainWindow && showWindow(mainWindow) },
      { label: 'Compartilhar Tela (Alt+S)', click: () => openShare() },
      {
        label: 'Parar Transmissão',
        enabled: roomState.sharing,
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('share:stop')
        }
      },
      { type: 'separator' },
      {
        label: 'Sair Completamente',
        click: () => {
          isQuiting = true
          app.quit()
        }
      }
    ])
  )
}

function ensureTray(): void {
  if (tray) return
  const icon = appIcon()
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Concord')
  const restore = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) showWindow(mainWindow)
    else showWindow(createWindow())
  }
  tray.on('click', restore)
  tray.on('double-click', restore)
  rebuildTrayMenu()
}

function registerWindowControls(): void {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle('window:is-maximized', (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)
  ipcMain.handle('window:set-fullscreen', (event, value: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    win.setFullScreen(value === true)
    return win.isFullScreen()
  })
  ipcMain.handle('room:state', (_event, state: unknown) => {
    if (!state || typeof state !== 'object') return
    const next = state as { inRoom?: unknown; sharing?: unknown }
    roomState = { inRoom: next.inRoom === true, sharing: next.sharing === true }
    rebuildTrayMenu()
  })
  ipcMain.handle('picker:confirm', (_event, settings: unknown) => {
    if (!settings || typeof settings !== 'object') return
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('share:start', settings)
    closePicker()
  })
  ipcMain.handle('picker:stop', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('share:stop')
    closePicker()
  })
  ipcMain.handle('picker:cancel', () => {
    closePicker()
  })
  ipcMain.handle('picker:room-state', () => roomState)
  ipcMain.handle('os:username', () => {
    try {
      return os.userInfo().username
    } catch {
      return ''
    }
  })
}

app.whenReady().then(() => {
  registerCapture()
  registerAudioLoopback()
  registerDiscord()
  registerUpdates()
  registerWindowControls()
  registerHotkey(openShare)
  ensureTray()
  createWindow()
  globalShortcut.register('CommandOrControl+Shift+N', () => {
    createWindow()
  })

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) showWindow(mainWindow)
    else showWindow(createWindow())
  })
})

app.on('before-quit', () => {
  isQuiting = true
})

app.on('window-all-closed', () => {
  if (isQuiting && process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const DEFAULT_HOTKEY = 'Alt+S'

function settingsPath(): string {
  return join(app.getPath('userData'), 'concord-settings.json')
}

function readHotkey(): string {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as { hotkey?: string }
    if (typeof parsed.hotkey === 'string' && parsed.hotkey.length > 0) return parsed.hotkey
  } catch {
    return DEFAULT_HOTKEY
  }
  return DEFAULT_HOTKEY
}

function writeHotkey(hotkey: string): void {
  writeFileSync(settingsPath(), JSON.stringify({ hotkey }), 'utf8')
}

export function registerHotkey(openShare: () => void): void {
  let current = readHotkey()

  const bind = (accelerator: string): boolean => {
    if (current) globalShortcut.unregister(current)
    const ok = globalShortcut.register(accelerator, openShare)
    if (!ok) {
      if (current) globalShortcut.register(current, openShare)
      return false
    }
    current = accelerator
    writeHotkey(accelerator)
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('hotkey:changed', current)
    }
    return true
  }

  if (!bind(current)) {
    current = DEFAULT_HOTKEY
    globalShortcut.register(current, openShare)
  }

  ipcMain.handle('hotkey:get', () => current)
  ipcMain.handle('hotkey:set', (_event, accelerator: unknown) => {
    if (typeof accelerator !== 'string' || accelerator.length < 3 || accelerator.length > 64) return false
    if (accelerator === 'CommandOrControl+Shift+N') return false
    return bind(accelerator)
  })
}

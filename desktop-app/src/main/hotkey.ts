import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

type Action = 'share' | 'mute' | 'deafen'

const DEFAULT_SHARE = 'Alt+S'
const RESERVED = 'CommandOrControl+Shift+N'
const FILE_KEYS: Record<Action, string> = { share: 'hotkey', mute: 'muteHotkey', deafen: 'deafenHotkey' }

function settingsPath(): string {
  return join(app.getPath('userData'), 'concord-settings.json')
}

function readSettings(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeSetting(action: Action, accelerator: string): void {
  // Preserva as demais chaves do arquivo, incluindo as de versões anteriores.
  const next = { ...readSettings(), [FILE_KEYS[action]]: accelerator }
  writeFileSync(settingsPath(), JSON.stringify(next), 'utf8')
}

function readAccelerator(action: Action, fallback: string): string {
  const value = readSettings()[FILE_KEYS[action]]
  return typeof value === 'string' ? value : fallback
}

const same = (a: string, b: string): boolean => a.length > 0 && a.toLowerCase() === b.toLowerCase()

export function registerHotkey(openShare: () => void): void {
  const current: Record<Action, string> = {
    share: readAccelerator('share', DEFAULT_SHARE) || DEFAULT_SHARE,
    mute: readAccelerator('mute', ''),
    deafen: readAccelerator('deafen', '')
  }

  const emitVoice = (channel: 'voice:toggle-mute' | 'voice:toggle-deafen'): void => {
    for (const win of BrowserWindows()) win.webContents.send(channel)
  }
  const BrowserWindows = (): BrowserWindow[] => BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())

  const handlers: Record<Action, () => void> = {
    share: openShare,
    mute: () => emitVoice('voice:toggle-mute'),
    deafen: () => emitVoice('voice:toggle-deafen')
  }

  const broadcast = (): void => {
    for (const win of BrowserWindows()) {
      win.webContents.send('hotkey:changed', current.share)
      win.webContents.send('hotkey:all-changed', { ...current })
    }
  }

  const conflictsWithOther = (action: Action, accelerator: string): boolean =>
    same(accelerator, RESERVED) ||
    (Object.keys(current) as Action[]).some((other) => other !== action && same(current[other], accelerator))

  const bind = (action: Action, accelerator: string): boolean => {
    const previous = current[action]
    if (accelerator === '') {
      if (previous) globalShortcut.unregister(previous)
      current[action] = ''
      writeSetting(action, '')
      broadcast()
      return true
    }
    if (conflictsWithOther(action, accelerator)) return false
    if (previous) globalShortcut.unregister(previous)
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, handlers[action])
    } catch {
      ok = false
    }
    if (!ok) {
      if (previous) globalShortcut.register(previous, handlers[action])
      return false
    }
    current[action] = accelerator
    writeSetting(action, accelerator)
    broadcast()
    return true
  }

  // Registro inicial: ações em conflito ou recusadas pelo sistema voltam ao padrão (share) ou ficam vazias.
  const stored = { ...current }
  current.share = ''
  current.mute = ''
  current.deafen = ''
  if (!bind('share', stored.share)) bind('share', DEFAULT_SHARE)
  if (stored.mute) bind('mute', stored.mute)
  if (stored.deafen) bind('deafen', stored.deafen)

  const valid = (value: unknown): value is string => typeof value === 'string' && value.length <= 64

  ipcMain.handle('hotkey:get', () => current.share)
  ipcMain.handle('hotkey:set', (_event, accelerator: unknown) => {
    if (!valid(accelerator) || accelerator.length < 3) return false
    return bind('share', accelerator)
  })
  ipcMain.handle('hotkey:get-all', () => ({ ...current }))
  ipcMain.handle('hotkey:set-action', (_event, action: unknown, accelerator: unknown) => {
    if (action !== 'share' && action !== 'mute' && action !== 'deafen') return false
    if (!valid(accelerator)) return false
    if (accelerator !== '' && accelerator.length < 3) return false
    if (action === 'share' && accelerator === '') return false
    return bind(action, accelerator)
  })
}

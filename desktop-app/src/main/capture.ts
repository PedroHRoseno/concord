import { execFile } from 'node:child_process'
import { app, desktopCapturer, ipcMain, powerSaveBlocker, session, systemPreferences, webContents, type DesktopCapturerSource } from 'electron'
interface PendingCapture {
  sourceId: string
  shareAudio: boolean
  loopbackWithScreen?: boolean
}

const pendingByContents = new Map<number, PendingCapture>()
let activeCaptures = 0
let blockerId: number | null = null

const emptyThumbnail = { width: 0, height: 0 }

function hwndOf(sourceId: string): number | null {
  const match = /^window:(\d+):/.exec(sourceId)
  if (!match) return null
  const hwnd = Number(match[1])
  return Number.isInteger(hwnd) && hwnd > 0 ? hwnd : null
}

function runPowerShell(script: string): Promise<string> {
  if (process.platform !== 'win32') return Promise.resolve('')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' },
      (error, stdout) => resolve(error ? '' : stdout)
    )
  })
}

const WIN32_TYPE =
  'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class ConcordWin { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }\';'

async function iconicSet(hwnds: number[]): Promise<Set<number>> {
  const unique = [...new Set(hwnds.filter((hwnd) => hwnd > 0))]
  if (unique.length === 0) return new Set()
  const script = `${WIN32_TYPE} @(${unique.join(',')}) | Where-Object { [ConcordWin]::IsIconic([IntPtr]$_) }`
  const stdout = await runPowerShell(script)
  const found = new Set<number>()
  for (const line of stdout.split(/\s+/)) {
    const hwnd = Number(line)
    if (Number.isInteger(hwnd) && hwnd > 0) found.add(hwnd)
  }
  return found
}

async function restoreWindow(hwnd: number): Promise<void> {
  if (process.platform !== 'win32' || hwnd <= 0) return
  await runPowerShell(`${WIN32_TYPE} [ConcordWin]::ShowWindow([IntPtr]${hwnd}, 9) | Out-Null`)
}

/**
 * Permissões que o app concede ao próprio renderer.
 * `fullscreen` é essencial: se for negada, `requestFullscreen()` nunca resolve nem rejeita (a Promise fica pendente).
 */
const GRANTED_PERMISSIONS = new Set(['media', 'display-capture', 'mediaKeySystem', 'fullscreen', 'speaker-selection', 'clipboard-sanitized-write'])

async function findSource(sourceId: string): Promise<DesktopCapturerSource | undefined> {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: emptyThumbnail,
    fetchWindowIcons: false
  })
  return sources.find((source) => source.id === sourceId)
}

const IGNORED_PROCESSES = new Set(['textinputhost', 'applicationframehost', 'systemsettings', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost'])

interface HiddenWindow {
  process: string
  title: string
  hwnd: number
}

/**
 * Janelas com título que o Windows conhece, mas o Chromium não enumera (minimizadas, em outra área de trabalho
 * virtual, elevadas/admin ou protegidas). Serve apenas para orientar o usuário na interface.
 */
function listHiddenWindows(knownIds: Set<string>): Promise<HiddenWindow[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  const script =
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
    'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ' +
    'ForEach-Object { [pscustomobject]@{ p = $_.ProcessName; h = [int64]$_.MainWindowHandle; t = $_.MainWindowTitle } } | ConvertTo-Json -Compress'
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve([])
        return
      }
      try {
        const parsed = JSON.parse(stdout) as { p: string; h: number; t: string } | Array<{ p: string; h: number; t: string }>
        const rows = Array.isArray(parsed) ? parsed : [parsed]
        const own = app.getName().toLowerCase()
        resolve(
          rows
            .filter((row) => !knownIds.has(`window:${row.h}:0`))
            .filter((row) => !IGNORED_PROCESSES.has(row.p.toLowerCase()) && row.p.toLowerCase() !== own && row.p.toLowerCase() !== 'concord')
            .map((row) => ({ process: row.p, title: row.t, hwnd: row.h }))
        )
      } catch {
        resolve([])
      }
    })
  })
}

export function registerCapture(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(GRANTED_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => GRANTED_PERMISSIONS.has(permission))

  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const contentsId = request.frame ? webContents.fromFrame(request.frame)?.id : undefined
        const pending = (contentsId !== undefined ? pendingByContents.get(contentsId) : undefined) ?? [...pendingByContents.values()].at(-1)
        if (!pending) {
          callback(null)
          return
        }
        const wantsAudio = pending.shareAudio && request.audioRequested
        const source = await findSource(pending.sourceId)
        if (!source) {
          callback(null)
          return
        }
        let video = source
        if (wantsAudio && pending.loopbackWithScreen) {
          const screens = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: emptyThumbnail,
            fetchWindowIcons: false
          })
          if (screens[0]) video = screens[0]
        }
        console.log(`[capture] ${video.id} audio=${wantsAudio ? 'loopback' : 'off'}`)
        callback({
          video,
          ...(wantsAudio ? { audio: 'loopback' as const } : {})
        })
      } catch {
        callback(null)
      }
    },
    { useSystemPicker: false }
  )

  ipcMain.handle('sources:list', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 400, height: 225 },
      fetchWindowIcons: true
    })
    const visible = sources.filter((source) => source.id.startsWith('screen:') || source.name.trim().length > 0)
    const iconic = await iconicSet(visible.map((source) => hwndOf(source.id) ?? 0))
    const hidden = await listHiddenWindows(new Set(sources.map((source) => source.id)))
    return [
      ...visible.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
        appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
        displayId: source.display_id,
        minimized: iconic.has(hwndOf(source.id) ?? 0)
      })),
      ...hidden.map((row) => ({
        id: `window:${row.hwnd}:0`,
        name: row.title,
        thumbnail: '',
        appIcon: null,
        displayId: '',
        minimized: true
      }))
    ]
  })

  /** Assinatura leve (sem miniaturas) para detectar janelas abertas/fechadas sem custo de captura. */
  ipcMain.handle('sources:signature', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: emptyThumbnail, fetchWindowIcons: false })
    return sources.map((source) => `${source.id}|${source.name}`).join('\n')
  })

  ipcMain.handle('sources:hidden', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: emptyThumbnail, fetchWindowIcons: false })
    return listHiddenWindows(new Set(sources.map((source) => source.id)))
  })

  ipcMain.handle('capture:prepare', async (event, options: PendingCapture) => {
    if (!options || typeof options.sourceId !== 'string') return false
    let sourceId = options.sourceId
    const hwnd = hwndOf(sourceId)
    if (hwnd) {
      await restoreWindow(hwnd)
      let found = await findSource(sourceId)
      if (!found) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        found = await findSource(sourceId)
      }
      if (found) sourceId = found.id
      else if (sourceId.startsWith('window:')) return false
    }
    pendingByContents.set(event.sender.id, {
      sourceId,
      shareAudio: Boolean(options.shareAudio),
      loopbackWithScreen: Boolean(options.loopbackWithScreen)
    })
    return true
  })

  ipcMain.handle('audio:microphone-access', () => systemPreferences.getMediaAccessStatus('microphone'))

  ipcMain.handle('capture:set-active', (_event, active: boolean) => {
    activeCaptures += active ? 1 : -1
    if (activeCaptures < 0) activeCaptures = 0
    if (activeCaptures > 0 && (blockerId === null || !powerSaveBlocker.isStarted(blockerId))) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension')
    }
    if (activeCaptures === 0 && blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
  })
}

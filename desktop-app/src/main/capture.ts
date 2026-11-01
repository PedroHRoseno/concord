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
            .map((row) => ({ process: row.p, title: row.t }))
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
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.isEmpty() ? '' : source.thumbnail.toDataURL(),
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
      displayId: source.display_id
    }))
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

  ipcMain.handle('capture:prepare', (event, options: PendingCapture) => {
    if (!options || typeof options.sourceId !== 'string') return false
    pendingByContents.set(event.sender.id, {
      sourceId: options.sourceId,
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

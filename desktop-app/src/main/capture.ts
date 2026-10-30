import { desktopCapturer, ipcMain, powerSaveBlocker, session, systemPreferences, webContents, type DesktopCapturerSource } from 'electron'

interface PendingCapture {
  sourceId: string
  shareAudio: boolean
  loopbackWithScreen?: boolean
}

const pendingByContents = new Map<number, PendingCapture>()
let activeCaptures = 0
let blockerId: number | null = null

const emptyThumbnail = { width: 0, height: 0 }

async function findSource(sourceId: string): Promise<DesktopCapturerSource | undefined> {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: emptyThumbnail,
    fetchWindowIcons: false
  })
  return sources.find((source) => source.id === sourceId)
}

export function registerCapture(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture' || permission === 'mediaKeySystem')
  })

  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const contentsId = request.frame ? webContents.fromFrame(request.frame)?.id : undefined
        const pending = (contentsId !== undefined ? pendingByContents.get(contentsId) : undefined) ?? [...pendingByContents.values()].at(-1)
        if (!pending) {
          callback(null)
          return
        }
        const source = await findSource(pending.sourceId)
        if (!source) {
          callback(null)
          return
        }
        const wantsAudio = pending.shareAudio && request.audioRequested
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

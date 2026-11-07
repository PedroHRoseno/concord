import { isMobile } from '@renderer/lib/platform'
import { RESOLUTION_OPTIONS, type CaptureSettings, type WebcamSettings } from '@renderer/types'
import { attachDesktopAudio, stopDesktopAudio } from '@renderer/lib/audio-loopback'

let audioFailure: string | null = null
const standbys = new WeakSet<MediaStream>()
const standbyTimers = new WeakMap<MediaStream, number>()

export function isStandbyStream(stream: MediaStream): boolean {
  return standbys.has(stream)
}

function videoConstraints(settings: CaptureSettings, strict: boolean): MediaTrackConstraints {
  const preset = RESOLUTION_OPTIONS.find((item) => item.id === settings.resolution)
  const video: MediaTrackConstraints = {
    frameRate: { ideal: settings.fps, max: settings.fps }
  }
  if (preset?.width && preset.height) {
    video.width = strict ? { ideal: preset.width, max: preset.width } : { ideal: preset.width }
    video.height = strict ? { ideal: preset.height, max: preset.height } : { ideal: preset.height }
  }
  return video
}

function isAudioSourceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('audio source') || message.includes('could not start audio')
}

function liveAudioTrack(stream: MediaStream): MediaStreamTrack | null {
  return stream.getAudioTracks().find((track) => track.readyState === 'live') ?? null
}

export function releaseSystemAudioAnchor(): void {
  stopDesktopAudio()
}

async function prepare(
  settings: CaptureSettings,
  shareAudio: boolean,
  loopbackWithScreen = false
): Promise<{ waiting: boolean }> {
  const bridge = window.electronAPI
  if (!bridge) throw new Error('A ponte do Electron não está disponível.')
  const prepared = await bridge.prepareCapture({
    sourceId: settings.sourceId,
    shareAudio,
    loopbackWithScreen
  })
  if (!prepared.ok) throw new Error('Não foi possível preparar a captura dessa janela.')
  return { waiting: prepared.waiting }
}

function paintStandby(ctx: CanvasRenderingContext2D, width: number, height: number, name: string): void {
  const sky = ctx.createLinearGradient(0, 0, width, height)
  sky.addColorStop(0, '#1a1c24')
  sky.addColorStop(1, '#05060a')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(88, 101, 242, 0.18)'
  ctx.beginPath()
  ctx.arc(width / 2, height / 2 - 20, 160, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 6
  ctx.strokeRect(width / 2 - 70, height / 2 - 90, 140, 96)
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 36px Segoe UI, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(name || 'Jogo', width / 2, height / 2 + 70, width - 80)
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.font = '500 28px Segoe UI, sans-serif'
  ctx.fillText('Aguardando janela do jogo...', width / 2, height / 2 + 120, width - 80)
}

function standbyStream(settings: CaptureSettings): MediaStream {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível preparar a espera da janela.')
  const draw = (): void => paintStandby(ctx, canvas.width, canvas.height, settings.sourceName)
  draw()
  const stream = canvas.captureStream(1)
  const timer = window.setInterval(draw, 1000)
  standbyTimers.set(stream, timer)
  const video = stream.getVideoTracks()[0]
  video?.addEventListener('ended', () => {
    const active = standbyTimers.get(stream)
    if (active !== undefined) window.clearInterval(active)
    standbyTimers.delete(stream)
  })
  standbys.add(stream)
  return stream
}

export function watchStandby(settings: CaptureSettings, onReady: (stream: MediaStream) => void): () => void {
  let stopped = false
  let busy = false
  const timer = window.setInterval(() => {
    void (async () => {
      if (stopped || busy) return
      const ready = await window.electronAPI?.probeCapture(settings.sourceId)
      if (!ready || stopped) return
      busy = true
      try {
        const next = await captureDesktop(settings, { standby: false, keepAudio: true })
        if (stopped) {
          next.getTracks().forEach((track) => track.stop())
          releaseSystemAudioAnchor()
          return
        }
        stopped = true
        window.clearInterval(timer)
        onReady(next)
      } catch (error) {
        console.warn('A janela ainda não entregou vídeo.', error)
        busy = false
      }
    })()
  }, 1000)
  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}

async function openDisplay(settings: CaptureSettings, strict: boolean, withAudio: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: videoConstraints(settings, strict),
    audio: withAudio
  })
}

async function openVideo(settings: CaptureSettings, allowStandby: boolean): Promise<MediaStream> {
  const prepared = await prepare(settings, false)
  const windowSource = settings.sourceId.startsWith('window:')
  if (allowStandby && prepared.waiting && windowSource) {
    const listed = await window.electronAPI?.probeCapture(settings.sourceId)
    if (!listed) return standbyStream(settings)
  }
  try {
    return await openDisplay(settings, true, false)
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
      try {
        return await openDisplay(settings, false, false)
      } catch (retry) {
        if (allowStandby && prepared.waiting && windowSource) return standbyStream(settings)
        throw retry
      }
    }
    if (allowStandby && prepared.waiting && windowSource) return standbyStream(settings)
    throw error
  }
}

async function audioFailureMessage(): Promise<string> {
  try {
    const access = await window.electronAPI?.getMicrophoneAccess()
    if (access === 'denied' || access === 'restricted') {
      return 'A tela foi compartilhada, mas o Windows bloqueou a captura de áudio deste app. Em Privacidade do microfone, permita o acesso para apps da área de trabalho.'
    }
  } catch (error) {
    console.warn('Não foi possível consultar a permissão de áudio.', error)
  }
  return 'A tela foi compartilhada, mas o Windows não iniciou o áudio do sistema. Desative os aprimoramentos de áudio do alto-falante padrão e tente de novo.'
}

async function attachInputDevice(stream: MediaStream, deviceId: string): Promise<void> {
  const audio = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    video: false
  })
  const track = liveAudioTrack(audio)
  if (!track) {
    audio.getTracks().forEach((item) => item.stop())
    audioFailure = 'O dispositivo de entrada não entregou áudio.'
    return
  }
  stream.addTrack(track)
}

export async function captureDesktop(
  settings: CaptureSettings,
  options?: { standby?: boolean; keepAudio?: boolean }
): Promise<MediaStream> {
  if (!window.electronAPI) throw new Error('A ponte do Electron não está disponível.')

  const allowStandby = options?.standby !== false
  if (!options?.keepAudio) releaseSystemAudioAnchor()
  audioFailure = null

  let stream: MediaStream
  if (settings.audioMode === 'window' && settings.sourceId.startsWith('window:')) {
    stream = await openVideo(settings, allowStandby)
    const audio = await attachDesktopAudio(settings.sourceId)
    if (audio && audio.readyState === 'live') stream.addTrack(audio)
    else audioFailure = 'Não foi possível isolar o áudio dessa janela.'
  } else if (settings.audioMode === 'system' || settings.audioMode === 'window') {
    stream = await openVideo(settings, allowStandby)
    const excludeId = settings.sourceId.startsWith('screen:') ? settings.sourceId : 'screen:0:0'
    const audio = await attachDesktopAudio(excludeId)
    if (audio && audio.readyState === 'live') stream.addTrack(audio)
    else audioFailure = 'Não foi possível capturar o áudio do sistema sem o som do Concord.'
  } else {
    stream = await openVideo(settings, allowStandby)
    if (settings.audioMode === 'device') {
      try {
        await attachInputDevice(stream, settings.audioDeviceId)
      } catch (error) {
        console.warn('Dispositivo de entrada falhou.', error)
        audioFailure = 'Não foi possível abrir o dispositivo de áudio escolhido.'
      }
    }
  }

  const video = stream.getVideoTracks()[0]
  if (!video) {
    stream.getTracks().forEach((track) => track.stop())
    releaseSystemAudioAnchor()
    throw new Error('A captura não devolveu vídeo.')
  }

  video.contentHint = settings.contentHint
  try {
    await video.applyConstraints(videoConstraints(settings, false))
  } catch (error) {
    console.warn('Constraints de vídeo não foram aceitas por completo.', error)
  }

  if (settings.audioMode !== 'none' && !liveAudioTrack(stream) && !audioFailure) {
    audioFailure = await audioFailureMessage()
  }

  return stream
}

export async function captureWebcam(settings: WebcamSettings): Promise<MediaStream> {
  const mobile = isMobile()
  const height = !mobile && settings.resolution === '1080p' ? 1080 : 720
  const width = !mobile && settings.resolution === '1080p' ? 1920 : 1280
  const video: MediaTrackConstraints = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: 30, max: 30 }
  }
  if (settings.facingMode) video.facingMode = { ideal: settings.facingMode }
  else if (settings.deviceId) video.deviceId = { exact: settings.deviceId }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video })
  const track = stream.getVideoTracks()[0]
  if (!track) {
    stream.getTracks().forEach((item) => item.stop())
    throw new Error('A câmera não devolveu vídeo.')
  }
  track.contentHint = 'detail'
  return stream
}

export function systemAudioWarning(stream: MediaStream, settings: CaptureSettings): string | null {
  if (settings.audioMode === 'none') return null
  if (liveAudioTrack(stream)) return null
  return audioFailure
}

export function captureErrorMessage(error: unknown): string {
  if (isAudioSourceError(error)) {
    return 'O Windows não iniciou o áudio do sistema junto com essa janela.'
  }
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'A captura de tela foi bloqueada pelo sistema.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Falha ao capturar a tela.'
}

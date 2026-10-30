import { RESOLUTION_OPTIONS, type CaptureSettings, type WebcamSettings } from '@renderer/types'
import { attachProcessAudio, stopProcessAudio } from '@renderer/lib/process-audio'

let audioAnchor: MediaStream | null = null
let audioFailure: string | null = null

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
  stopProcessAudio()
  const anchor = audioAnchor
  audioAnchor = null
  anchor?.getTracks().forEach((track) => track.stop())
}

async function prepare(settings: CaptureSettings, shareAudio: boolean, loopbackWithScreen = false): Promise<void> {
  const bridge = window.electronAPI
  if (!bridge) throw new Error('A ponte do Electron não está disponível.')
  const prepared = await bridge.prepareCapture({
    sourceId: settings.sourceId,
    shareAudio,
    loopbackWithScreen
  })
  if (!prepared) throw new Error('Não foi possível preparar a captura dessa janela.')
}

async function openDisplay(settings: CaptureSettings, strict: boolean, withAudio: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: videoConstraints(settings, strict),
    audio: withAudio
  })
}

async function openVideo(settings: CaptureSettings): Promise<MediaStream> {
  await prepare(settings, false)
  try {
    return await openDisplay(settings, true, false)
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
      return openDisplay(settings, false, false)
    }
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

async function takeSystemAudio(settings: CaptureSettings, loopbackWithScreen: boolean): Promise<MediaStreamTrack | null> {
  await prepare(settings, true, loopbackWithScreen)
  try {
    const loopback = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    const track = liveAudioTrack(loopback)
    if (!track) {
      loopback.getTracks().forEach((item) => item.stop())
      audioFailure = await audioFailureMessage()
      return null
    }
    // O vídeo auxiliar fica vivo: no Windows, pará-lo encerra o áudio do mesmo loopback.
    audioAnchor = loopback
    return track
  } catch (error) {
    console.warn('Loopback de áudio do sistema falhou.', error)
    audioFailure = await audioFailureMessage()
    return null
  }
}

async function openScreenWithAudio(settings: CaptureSettings): Promise<MediaStream | null> {
  await prepare(settings, true, false)
  try {
    return await openDisplay(settings, false, true)
  } catch (error) {
    if (!isAudioSourceError(error)) throw error
    console.warn('Áudio do sistema junto com a tela falhou.', error)
    audioFailure = await audioFailureMessage()
    return null
  }
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

async function attachAppAudio(settings: CaptureSettings, stream: MediaStream): Promise<MediaStream> {
  if (settings.sourceId.startsWith('window:')) {
    const processTrack = await attachProcessAudio(settings.sourceId)
    if (processTrack) {
      stream.addTrack(processTrack)
      return stream
    }
  }
  if (settings.sourceId.startsWith('screen:')) {
    const combined = await openScreenWithAudio(settings)
    if (combined && liveAudioTrack(combined)) {
      stream.getTracks().forEach((track) => track.stop())
      return combined
    }
    combined?.getTracks().forEach((track) => track.stop())
  }
  const audio = await takeSystemAudio(settings, true)
  if (audio && audio.readyState === 'live') stream.addTrack(audio)
  return stream
}

export async function captureDesktop(settings: CaptureSettings): Promise<MediaStream> {
  if (!window.electronAPI) throw new Error('A ponte do Electron não está disponível.')

  releaseSystemAudioAnchor()
  audioFailure = null

  let stream = await openVideo(settings)
  if (settings.audioMode === 'device') {
    try {
      await attachInputDevice(stream, settings.audioDeviceId)
    } catch (error) {
      console.warn('Dispositivo de entrada falhou.', error)
      audioFailure = 'Não foi possível abrir o dispositivo de áudio escolhido.'
    }
  } else if (settings.audioMode === 'app') {
    stream = await attachAppAudio(settings, stream)
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
  const height = settings.resolution === '1080p' ? 1080 : 720
  const width = settings.resolution === '1080p' ? 1920 : 1280
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined,
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30, max: 30 }
    }
  })
  const video = stream.getVideoTracks()[0]
  if (!video) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error('A câmera não devolveu vídeo.')
  }
  video.contentHint = 'detail'
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

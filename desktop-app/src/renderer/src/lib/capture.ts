import { RESOLUTION_OPTIONS, type CaptureSettings, type WebcamSettings } from '@renderer/types'
import { attachDesktopAudio, stopDesktopAudio } from '@renderer/lib/audio-loopback'

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
  stopDesktopAudio()
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

export async function captureDesktop(settings: CaptureSettings): Promise<MediaStream> {
  if (!window.electronAPI) throw new Error('A ponte do Electron não está disponível.')

  releaseSystemAudioAnchor()
  audioFailure = null

  let stream: MediaStream
  if (settings.audioMode === 'window' && settings.sourceId.startsWith('window:')) {
    stream = await openVideo(settings)
    const audio = await attachDesktopAudio(settings.sourceId)
    if (audio && audio.readyState === 'live') stream.addTrack(audio)
    else audioFailure = 'Não foi possível isolar o áudio dessa janela.'
  } else if (settings.audioMode === 'system' || settings.audioMode === 'window') {
    stream = await openVideo(settings)
    const excludeId = settings.sourceId.startsWith('screen:') ? settings.sourceId : 'screen:0:0'
    const audio = await attachDesktopAudio(excludeId)
    if (audio && audio.readyState === 'live') stream.addTrack(audio)
    else audioFailure = 'Não foi possível capturar o áudio do sistema sem o som do Concord.'
  } else {
    stream = await openVideo(settings)
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

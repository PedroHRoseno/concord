const VOLUME_KEY = 'concord.music.volume'
const listeners = new Set<() => void>()
let volume = readStoredVolume()
let muted = false
let deafened = false
let generation = 0
let audio: HTMLAudioElement | null = null
let frame: YTPlayer | null = null
let hostMount: HTMLDivElement | null = null
let remoteAudio: HTMLAudioElement | null = null
let remoteContext: AudioContext | null = null
let remoteGain: GainNode | null = null
let localOnly = false

interface YTPlayer {
  destroy: () => void
  setVolume: (value: number) => void
  mute: () => void
  unMute: () => void
}

interface YTOptions {
  videoId: string
  width: number
  height: number
  playerVars: Record<string, number | string>
  events: { onReady?: (event: { target: YTPlayer }) => void; onStateChange?: (event: { data: number }) => void; onError?: () => void }
}

declare global {
  interface Window {
    YT?: { Player: new (element: HTMLElement, options: YTOptions) => YTPlayer }
    onYouTubeIframeAPIReady?: () => void
  }
}

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw === null) return 0.2
    const value = Number(raw)
    if (Number.isFinite(value)) return Math.min(1, Math.max(0, value))
  } catch {
    /* o padrão de 20% continua valendo */
  }
  return 0.2
}

function emit(): void {
  for (const listener of listeners) listener()
}

function heard(): number {
  if (muted || deafened) return 0
  return volume
}

function applyHostVolume(): void {
  const level = heard()
  if (audio) audio.volume = level
  if (!frame) return
  try {
    frame.setVolume(Math.round(level * 100))
    if (level === 0) frame.mute()
    else frame.unMute()
  } catch {
    /* o player ainda está carregando */
  }
}

function applyRemoteVolume(): void {
  if (remoteGain) remoteGain.gain.value = heard()
}

export function readMusicVolume(): number {
  return volume
}

export function readMusicMuted(): boolean {
  return muted
}

export function musicIsLocalOnly(): boolean {
  return localOnly
}

export function subscribeMusicPrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function writeMusicVolume(next: number): void {
  volume = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0.2))
  try {
    localStorage.setItem(VOLUME_KEY, String(volume))
  } catch {
    /* a preferência vale nesta sessão */
  }
  applyHostVolume()
  applyRemoteVolume()
  emit()
}

export function writeMusicMuted(next: boolean): void {
  muted = next
  applyHostVolume()
  applyRemoteVolume()
  emit()
}

export function setMusicDeafened(next: boolean): void {
  if (deafened === next) return
  deafened = next
  applyHostVolume()
  applyRemoteVolume()
}

function clearHost(): void {
  audio?.pause()
  if (audio) {
    audio.src = ''
    audio.onended = null
  }
  audio = null
  try {
    frame?.destroy()
  } catch {
    /* o iframe já saiu */
  }
  frame = null
  hostMount?.remove()
  hostMount = null
}

export function stopJukebox(): void {
  generation += 1
  localOnly = false
  clearHost()
}

function loadYoutubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => reject(new Error('Não foi possível carregar o player do YouTube.'))
    document.head.appendChild(script)
  })
}

function playIframe(videoId: string, gen: number, onEnded: () => void): Promise<void> {
  return loadYoutubeApi().then(
    () =>
      new Promise((resolve, reject) => {
        const Factory = window.YT?.Player
        if (gen !== generation || !Factory) {
          reject(new Error('A música foi trocada.'))
          return
        }
        const mount = document.createElement('div')
        mount.setAttribute('aria-hidden', 'true')
        mount.style.position = 'fixed'
        mount.style.left = '-200vw'
        mount.style.width = '320px'
        mount.style.height = '180px'
        mount.style.pointerEvents = 'none'
        document.body.appendChild(mount)
        hostMount = mount
        let settled = false
        frame = new Factory(mount, {
          videoId,
          width: 320,
          height: 180,
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0 },
          events: {
            onReady: (event) => {
              if (gen !== generation) {
                event.target.destroy()
                return
              }
              applyHostVolume()
              if (!settled) {
                settled = true
                resolve()
              }
            },
            onStateChange: (event) => {
              if (gen === generation && event.data === 0) onEnded()
            },
            onError: () => {
              if (gen !== generation || settled) return
              settled = true
              reject(new Error('O YouTube recusou essa faixa.'))
            }
          }
        })
      })
  )
}

async function playCaptured(videoId: string, gen: number, onEnded: () => void): Promise<MediaStream | null> {
  const upstream = await window.electronAPI?.musicAudioUrl(videoId)
  if (!upstream || gen !== generation) return null
  const element = new Audio()
  element.crossOrigin = 'anonymous'
  element.preload = 'auto'
  element.src = `concord-media://play/?src=${encodeURIComponent(upstream)}`
  audio = element
  applyHostVolume()
  element.onended = () => {
    if (gen === generation) onEnded()
  }
  await element.play()
  if (gen !== generation) return null
  const captured = (element as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream?.()
  const track = captured?.getAudioTracks().find((item) => item.readyState === 'live')
  return track ? new MediaStream([track]) : null
}

/** Quem adicionou a faixa toca o áudio e, no desktop, publica a track para a sala. */
export async function playHost(videoId: string, onEnded: () => void): Promise<MediaStream | null> {
  const gen = ++generation
  clearHost()
  localOnly = false
  if (window.electronAPI?.musicAudioUrl) {
    try {
      const stream = await playCaptured(videoId, gen, onEnded)
      if (gen !== generation) return null
      if (stream) return stream
      clearHost()
    } catch (error) {
      if (gen !== generation) return null
      console.warn('Áudio direto do YouTube indisponível.', error)
      clearHost()
    }
  }
  await playIframe(videoId, gen, onEnded)
  if (gen !== generation) return null
  localOnly = true
  return null
}

/** O áudio recebido fica no grafo local, separado da voz e da tela. */
export function attachRemoteMusic(stream: MediaStream): void {
  detachRemoteMusic()
  const element = document.createElement('audio')
  element.autoplay = true
  element.muted = true
  element.srcObject = stream
  element.play().catch(() => undefined)
  remoteAudio = element
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const gain = context.createGain()
  gain.gain.value = heard()
  source.connect(gain)
  gain.connect(context.destination)
  void context.resume()
  remoteContext = context
  remoteGain = gain
}

export function detachRemoteMusic(): void {
  remoteAudio?.pause()
  if (remoteAudio) remoteAudio.srcObject = null
  remoteAudio = null
  remoteGain = null
  const context = remoteContext
  remoteContext = null
  void context?.close()
}

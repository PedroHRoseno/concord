const VOLUME_KEY = 'concord.music.volume'
const DRIFT_SECONDS = 2
const YT_ENDED = 0
const YT_PLAYING = 1
const YT_BUFFERING = 3

const prefListeners = new Set<() => void>()
const playbackListeners = new Set<() => void>()
let volume = readStoredVolume()
let muted = false
let deafened = false
let generation = 0
let frame: YTPlayer | null = null
let hostMount: HTMLDivElement | null = null
let gestureNeeded = false
let pendingAlign: number | null = null
let youtubeApi: Promise<void> | null = null

interface YTPlayer {
  destroy: () => void
  playVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getPlayerState: () => number
  setVolume: (value: number) => void
  mute: () => void
  unMute: () => void
}

interface YTOptions {
  videoId: string
  width: number
  height: number
  playerVars: Record<string, number | string>
  events: {
    onReady?: (event: { target: YTPlayer }) => void
    onStateChange?: (event: { data: number }) => void
    onError?: () => void
  }
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

function emitPrefs(): void {
  for (const listener of prefListeners) listener()
}

function emitPlayback(): void {
  for (const listener of playbackListeners) listener()
}

function setGesture(next: boolean): void {
  if (gestureNeeded === next) return
  gestureNeeded = next
  emitPlayback()
}

function heard(): number {
  if (muted || deafened) return 0
  return volume
}

function applyVolume(): void {
  if (!frame) return
  const level = heard()
  try {
    frame.setVolume(Math.round(level * 100))
    if (level === 0) frame.mute()
    else frame.unMute()
  } catch {
    /* o player ainda está carregando */
  }
}

export function readMusicVolume(): number {
  return volume
}

export function readMusicMuted(): boolean {
  return muted
}

export function musicNeedsGesture(): boolean {
  return gestureNeeded
}

export function subscribeMusicPrefs(listener: () => void): () => void {
  prefListeners.add(listener)
  return () => prefListeners.delete(listener)
}

export function subscribeJukebox(listener: () => void): () => void {
  playbackListeners.add(listener)
  return () => playbackListeners.delete(listener)
}

export function writeMusicVolume(next: number): void {
  volume = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0.2))
  try {
    localStorage.setItem(VOLUME_KEY, String(volume))
  } catch {
    /* a preferência vale nesta sessão */
  }
  applyVolume()
  emitPrefs()
}

export function writeMusicMuted(next: boolean): void {
  muted = next
  applyVolume()
  emitPrefs()
}

export function setMusicDeafened(next: boolean): void {
  if (deafened === next) return
  deafened = next
  applyVolume()
}

function clearHost(): void {
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
  pendingAlign = null
  clearHost()
  setGesture(false)
}

function loadYoutubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (youtubeApi) return youtubeApi
  youtubeApi = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      youtubeApi = null
      reject(new Error('Não foi possível carregar o player do YouTube.'))
    }
    document.head.appendChild(script)
  })
  return youtubeApi
}

function playerState(player: YTPlayer): number {
  try {
    return player.getPlayerState()
  } catch {
    return -1
  }
}

function armAutoplayCheck(player: YTPlayer, gen: number, note: (state: number) => void): void {
  window.setTimeout(() => {
    if (gen !== generation || frame !== player) return
    note(playerState(player))
  }, 1500)
}

/** Cada cliente toca a faixa no próprio aparelho. `onEnded` só vem do maestro. */
export function playLocal(videoId: string, startAt: number, onEnded: (() => void) | null): Promise<void> {
  const gen = ++generation
  pendingAlign = null
  clearHost()
  setGesture(false)
  let ended = false
  const finish = () => {
    if (ended || gen !== generation) return
    ended = true
    onEnded?.()
  }
  return loadYoutubeApi().then(
    () =>
      new Promise<void>((resolve, reject) => {
        const Factory = window.YT?.Player
        if (gen !== generation || !Factory) {
          resolve()
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
        const begin = startAt > 0.5 && Number.isFinite(startAt) ? startAt : 0
        let played = false
        let readyForGesture = false
        const note = (state: number) => {
          if (gen !== generation) return
          if (state === YT_PLAYING) {
            played = true
            setGesture(false)
            return
          }
          if (state === YT_BUFFERING) {
            setGesture(false)
            return
          }
          if (state === YT_ENDED) {
            setGesture(false)
            finish()
            return
          }
          if (readyForGesture && !played) setGesture(true)
        }
        frame = new Factory(mount, {
          videoId,
          width: 320,
          height: 180,
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, playsinline: 1 },
          events: {
            onReady: (event) => {
              if (gen !== generation) {
                event.target.destroy()
                resolve()
                return
              }
              applyVolume()
              if (begin > 0) event.target.seekTo(begin, true)
              if (pendingAlign !== null && Math.abs(pendingAlign - begin) > DRIFT_SECONDS) event.target.seekTo(pendingAlign, true)
              pendingAlign = null
              event.target.playVideo()
              armAutoplayCheck(event.target, gen, (state) => {
                readyForGesture = true
                note(state)
              })
              resolve()
            },
            onStateChange: (event) => note(event.data),
            onError: () => {
              if (gen !== generation) {
                resolve()
                return
              }
              finish()
              reject(new Error('O YouTube recusou essa faixa.'))
            }
          }
        })
      })
  )
}

export function readJukeboxTime(): number | null {
  if (!frame) return null
  try {
    const time = frame.getCurrentTime()
    return Number.isFinite(time) && time >= 0 ? time : null
  } catch {
    return null
  }
}

/** O maestro só publica o tempo quando a faixa está de fato andando. */
export function readJukeboxSyncTime(): number | null {
  if (!frame) return null
  const state = playerState(frame)
  if (state !== YT_PLAYING && state !== YT_BUFFERING) return null
  return readJukeboxTime()
}

export function alignJukebox(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return
  if (!frame) {
    pendingAlign = seconds
    return
  }
  const local = readJukeboxTime()
  if (local !== null && Math.abs(local - seconds) <= DRIFT_SECONDS) return
  try {
    frame.seekTo(seconds, true)
  } catch {
    pendingAlign = seconds
  }
}

/** Precisa rodar no clique: o navegador só libera o áudio com um gesto. */
export function resumeJukebox(): void {
  const player = frame
  if (!player) return
  try {
    player.playVideo()
  } catch {
    setGesture(true)
    return
  }
  setGesture(false)
  window.setTimeout(() => {
    if (frame !== player) return
    const state = playerState(player)
    if (state !== YT_PLAYING && state !== YT_BUFFERING && state !== YT_ENDED) setGesture(true)
  }, 700)
}

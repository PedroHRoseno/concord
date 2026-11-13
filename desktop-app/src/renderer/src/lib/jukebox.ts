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
    onError?: (event: { data: number }) => void
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

/**
 * O ouvido é logarítmico e o volume do `<video>` é linear em amplitude, então o slider segue uma
 * curva quadrática (20% vira 0,04, 10% vira 0,01).
 */
function amplitude(level: number): number {
  return level <= 0 ? 0 : level * level
}

function applyVolume(): void {
  if (!frame) return
  const level = heard()
  const target = amplitude(level)
  try {
    // Reserva para quando o ajuste direto no iframe não existe (build web). O YouTube trava
    // qualquer valor de 1 a 5 em 5, por isso o ajuste fino vem do processo main.
    frame.setVolume(target === 0 ? 0 : Math.max(1, Math.round(target * 100)))
    if (level === 0) frame.mute()
    else frame.unMute()
  } catch {
    /* o player ainda está carregando */
  }
  void window.electronAPI?.setMusicFrameVolume?.(target).catch(() => undefined)
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

const READY_TIMEOUT_MS = 12_000

interface YoutubeFailure {
  message: string
  /** Só erro da faixa em si (removida, privada, embed bloqueado) justifica pular. */
  skip: boolean
}

/**
 * Erro do player não é fim de faixa. Pular a fila por erro de ambiente (153, 5) apagaria
 * todas as músicas, uma por uma, sem o usuário saber o motivo.
 */
function describeYoutubeError(code: number): YoutubeFailure {
  switch (code) {
    case 2:
      return { message: 'O YouTube não reconheceu o ID desse vídeo. A faixa será pulada.', skip: true }
    case 100:
      return { message: 'Esse vídeo foi removido ou está privado. A faixa será pulada.', skip: true }
    case 101:
    case 150:
      return { message: 'O dono do vídeo não permite tocar fora do YouTube. A faixa será pulada.', skip: true }
    case 153:
      return { message: 'O YouTube recusou abrir o player dentro do Concord (erro 153). Quem adicionou a faixa pode pular.', skip: false }
    case 5:
      return { message: 'O player do YouTube falhou ao carregar a faixa (erro 5). Quem adicionou a faixa pode pular.', skip: false }
    default:
      return { message: `O YouTube não conseguiu tocar essa faixa (erro ${code}). Quem adicionou a faixa pode pular.`, skip: false }
  }
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
export function playLocal(videoId: string, startAt: number, onEnded: (() => void) | null, onFail?: (message: string) => void): Promise<void> {
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
      new Promise<void>((resolve) => {
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
        let ready = false
        window.setTimeout(() => {
          if (ready || gen !== generation) return
          onFail?.('O player do YouTube não respondeu. Confira a conexão e tente adicionar a faixa de novo.')
        }, READY_TIMEOUT_MS)
        const note = (state: number) => {
          if (gen !== generation) return
          if (state === YT_PLAYING) {
            // O iframe reaplica o volume salvo do YouTube quando a faixa começa e ignora o do onReady.
            if (!played) applyVolume()
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
              ready = true
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
            onError: (event) => {
              ready = true
              resolve()
              if (gen !== generation) return
              const failure = describeYoutubeError(Number(event?.data))
              onFail?.(failure.message)
              if (failure.skip) finish()
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

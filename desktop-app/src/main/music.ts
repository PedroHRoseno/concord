import { ipcMain, type WebContents } from 'electron'

export interface MusicSearchResult {
  videoId: string
  title: string
  channel: string
  duration: string
  thumbnail: string
}

const ENDPOINT = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false'
const CLIENT_VERSION = '2.20251110.00.00'
/** Filtro "Tipo: vídeo" da busca do YouTube. Tira canais, playlists e shorts da lista. */
const ONLY_VIDEOS = 'EgIQAQ%3D%3D'
const MAX_RESULTS = 12
const TIMEOUT_MS = 8000

interface Runs {
  runs?: Array<{ text?: string }>
  simpleText?: string
}

interface VideoRenderer {
  videoId?: string
  title?: Runs
  ownerText?: Runs
  lengthText?: Runs
}

function text(value: Runs | undefined): string {
  if (!value) return ''
  if (typeof value.simpleText === 'string') return value.simpleText
  return (value.runs ?? []).map((run) => run.text ?? '').join('')
}

function toResult(video: VideoRenderer): MusicSearchResult | null {
  const videoId = video.videoId ?? ''
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
  const duration = text(video.lengthText)
  // Sem duração é live: ela não termina e travaria a fila.
  if (!duration) return null
  return {
    videoId,
    title: text(video.title).slice(0, 140) || 'YouTube',
    channel: text(video.ownerText).slice(0, 80),
    duration,
    // A da busca vem em 720p; a lista só precisa de 320x180.
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
  }
}

/** Procura `videoRenderer` em qualquer nível: o YouTube muda o aninhamento da resposta sem aviso. */
function collect(node: unknown, out: MusicSearchResult[], seen: Set<string>): void {
  if (out.length >= MAX_RESULTS || !node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, seen)
    return
  }
  const record = node as Record<string, unknown>
  if (record.videoRenderer && typeof record.videoRenderer === 'object') {
    const result = toResult(record.videoRenderer as VideoRenderer)
    if (result && !seen.has(result.videoId)) {
      seen.add(result.videoId)
      out.push(result)
    }
    return
  }
  for (const value of Object.values(record)) collect(value, out, seen)
}

/**
 * Busca direto na API interna do site do YouTube, da conexão de quem pesquisa.
 * Não usa chave nem cota e não passa pelo servidor de sinalização.
 */
export async function searchMusic(query: string): Promise<MusicSearchResult[]> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: CLIENT_VERSION, hl: 'pt', gl: 'BR' } },
      query,
      params: ONLY_VIDEOS
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`YouTube respondeu ${response.status}`)
  const out: MusicSearchResult[] = []
  collect(await response.json(), out, new Set())
  return out
}

const EMBED_PREFIXES = ['https://www.youtube.com/embed/', 'https://www.youtube-nocookie.com/embed/']

/**
 * O `setVolume` do YouTube tem piso: qualquer valor de 1 a 5 vira 5, alto demais para música
 * de fundo. Aqui o volume vai direto no `<video>` do iframe da Jukebox. O gancho reaplica o alvo
 * quando o player mexe no volume sozinho (troca de qualidade, nova mídia).
 */
function frameVolumeScript(target: number): string {
  return `(() => {
    window.__concordVolume = ${target}
    const apply = () => {
      const video = document.querySelector('video')
      if (video && Math.abs(video.volume - window.__concordVolume) > 0.0005) video.volume = window.__concordVolume
    }
    if (!window.__concordVolumeHook) {
      window.__concordVolumeHook = true
      for (const name of ['volumechange', 'loadeddata', 'playing']) document.addEventListener(name, apply, true)
    }
    apply()
  })()`
}

async function setFrameVolume(contents: WebContents, target: number): Promise<boolean> {
  const frames = contents.mainFrame.framesInSubtree.filter((frame) => EMBED_PREFIXES.some((prefix) => frame.url.startsWith(prefix)))
  const results = await Promise.all(
    frames.map((frame) =>
      frame.executeJavaScript(frameVolumeScript(target)).then(
        () => true,
        () => false
      )
    )
  )
  return results.includes(true)
}

export function registerMusic(): void {
  ipcMain.handle('music:frame-volume', (event, raw: unknown): Promise<boolean> | boolean => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return false
    return setFrameVolume(event.sender, Math.min(1, Math.max(0, raw)))
  })

  ipcMain.handle('music:search', async (_event, raw: unknown): Promise<{ ok: boolean; results: MusicSearchResult[] }> => {
    if (typeof raw !== 'string') return { ok: false, results: [] }
    const query = raw.trim().slice(0, 200)
    if (!query) return { ok: true, results: [] }
    try {
      return { ok: true, results: await searchMusic(query) }
    } catch (error) {
      console.warn('[music] busca falhou', error)
      return { ok: false, results: [] }
    }
  })
}

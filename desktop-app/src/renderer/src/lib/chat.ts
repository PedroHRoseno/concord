const PREVIEW_KEY = 'concord.chat.previews'
const IMAGE_LIMIT = 85_000
const IMAGE_PREFIX = 'data:image/webp;base64,'
const MAX_SIDE = 960

export const CHAT_TEXT_LIMIT = 2000

export function readPreviews(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) !== '0'
  } catch {
    return true
  }
}

export function writePreviews(enabled: boolean): void {
  try {
    localStorage.setItem(PREVIEW_KEY, enabled ? '1' : '0')
  } catch {
    /* a escolha vale nesta sessão */
  }
}

export type LinkEmbed = 'image' | 'video' | 'youtube' | 'twitch' | 'page'

export type ChatPart = { kind: 'text'; value: string } | { kind: 'link'; value: string; embed: LinkEmbed | null }

const URL_RE = /https?:\/\/[^\s<>"']+/gi
const TRAILING_RE = /[.,;:!?)\]]+$/

export function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0] ?? ''
      return /^[\w-]{6,}$/.test(id) ? id : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname === '/watch') {
        const id = parsed.searchParams.get('v') ?? ''
        return /^[\w-]{6,}$/.test(id) ? id : null
      }
      const parts = parsed.pathname.split('/').filter(Boolean)
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1] && /^[\w-]{6,}$/.test(parts[1])) return parts[1]
    }
  } catch {
    return null
  }
  return null
}

export function linkEmbed(url: string): LinkEmbed | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const path = parsed.pathname.toLowerCase()
  if (/\.(png|jpe?g|gif|webp)$/.test(path)) return 'image'
  if (/\.(mp4|webm)$/.test(path)) return 'video'
  if (youtubeId(url)) return 'youtube'
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) return 'twitch'
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return 'page'
  return null
}

export function splitLinks(text: string): ChatPart[] {
  const parts: ChatPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0
    let url = match[0]
    const trailing = TRAILING_RE.exec(url)?.[0] ?? ''
    if (trailing) url = url.slice(0, url.length - trailing.length)
    if (index > last) parts.push({ kind: 'text', value: text.slice(last, index) })
    parts.push({ kind: 'link', value: url, embed: linkEmbed(url) })
    last = index + url.length
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) })
  return parts
}

export function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  if (window.electronAPI?.openExternal) {
    void window.electronAPI.openExternal(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export interface UnfurlCard {
  url: string
  kind: 'youtube' | 'twitch' | 'image' | 'link'
  title: string
  description: string
  image: string
  siteName: string
}

const unfurlCache = new Map<string, Promise<UnfurlCard | null>>()

export function fetchUnfurl(signalingUrl: string, target: string): Promise<UnfurlCard | null> {
  const cached = unfurlCache.get(target)
  if (cached) return cached
  const pending = requestUnfurl(signalingUrl, target)
  unfurlCache.set(target, pending)
  return pending
}

async function requestUnfurl(signalingUrl: string, target: string): Promise<UnfurlCard | null> {
  try {
    const url = new URL(signalingUrl)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = '/unfurl'
    url.search = ''
    url.hash = ''
    url.searchParams.set('url', target)
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(6000) })
    if (!response.ok) return null
    const data = (await response.json()) as Partial<UnfurlCard>
    if (typeof data.title !== 'string' && typeof data.image !== 'string') return null
    return {
      url: target,
      kind: data.kind === 'youtube' || data.kind === 'twitch' || data.kind === 'image' ? data.kind : 'link',
      title: data.title ?? '',
      description: data.description ?? '',
      image: data.image ?? '',
      siteName: data.siteName ?? ''
    }
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler a imagem.'))
    reader.readAsDataURL(blob)
  })
}

function toWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

/** Reduz a imagem para WebP de até ~960 px, baixando a qualidade (e depois o tamanho) até caber no limite do servidor. */
export async function compressImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    for (let round = 0; round < 6; round++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Não foi possível processar a imagem.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (let quality = 0.8; quality >= 0.3; quality -= 0.1) {
        const blob = await toWebp(canvas, quality)
        if (!blob || blob.type !== 'image/webp') throw new Error('Este sistema não gera imagens WebP.')
        const url = await blobToDataUrl(blob)
        if (url.startsWith(IMAGE_PREFIX) && url.length <= IMAGE_LIMIT) return url
      }
      scale *= 0.75
    }
  } finally {
    bitmap.close()
  }
  throw new Error('A imagem é grande demais para o chat.')
}

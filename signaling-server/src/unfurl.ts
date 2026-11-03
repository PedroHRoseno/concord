import { lookup } from 'node:dns/promises'
import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

export interface UnfurlCard {
  url: string
  kind: 'youtube' | 'twitch' | 'image' | 'link'
  title: string
  description: string
  image: string
  siteName: string
}

const CACHE_MS = 10 * 60_000
const CACHE_MAX = 200
const HTML_MAX = 256_000
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30

const cache = new Map<string, { at: number; card: UnfurlCard }>()
const hits = new Map<string, number[]>()

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => {
      const parsed = Number(code)
      return parsed > 0 && parsed < 0x110000 ? String.fromCodePoint(parsed) : ''
    })
}

export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0]?.trim() || 'unknown'
  return req.socket.remoteAddress ?? 'unknown'
}

function allowedRate(ip: string): boolean {
  const now = Date.now()
  if (hits.size > 2000) {
    for (const [key, stamps] of hits) {
      if (stamps.every((at) => now - at >= RATE_WINDOW_MS)) hits.delete(key)
    }
  }
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent)
    return false
  }
  recent.push(now)
  hits.set(ip, recent)
  return true
}

function blockedIp(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  const value = mapped?.[1] ?? ip
  if (value.includes(':')) {
    const lower = value.toLowerCase().split('%')[0] ?? value
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true
    }
    return false
  }
  const parts = value.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const a = parts[0] ?? 0
  const b = parts[1] ?? 0
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a >= 224) return true
  return false
}

async function isSafeUrl(raw: string): Promise<URL | null> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password || raw.length > 2000) return null
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost') || host === 'metadata.google.internal') {
    return null
  }
  if (isIP(host) && blockedIp(host)) return null
  try {
    const records = await lookup(host, { all: true, verbatim: true })
    if (records.length === 0 || records.some((record) => blockedIp(record.address))) return null
  } catch {
    return null
  }
  return url
}

function remember(key: string, card: UnfurlCard): UnfurlCard {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), card })
  return card
}

function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
    return /^[\w-]{6,}$/.test(id) ? id : null
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? ''
      return /^[\w-]{6,}$/.test(id) ? id : null
    }
    const parts = url.pathname.split('/').filter(Boolean)
    if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1] && /^[\w-]{6,}$/.test(parts[1])) return parts[1]
  }
  return null
}

function kindOf(url: URL): UnfurlCard['kind'] {
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (youtubeId(url)) return 'youtube'
  if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) return 'twitch'
  if (/\.(png|jpe?g|gif|webp)$/i.test(url.pathname)) return 'image'
  return 'link'
}

function meta(html: string, key: string): string {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    'i'
  )
  const match = pattern.exec(html)
  return decode(match?.[1] || match?.[2] || '')
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  let total = 0
  const decoder = new TextDecoder()
  let text = ''
  while (total < HTML_MAX) {
    const step = await reader.read()
    if (step.done) break
    total += step.value.byteLength
    text += decoder.decode(step.value, { stream: true })
  }
  text += decoder.decode()
  await reader.cancel().catch(() => undefined)
  return text.slice(0, HTML_MAX)
}

async function fetchText(url: URL, accept: string, hops = 0): Promise<{ url: URL; body: string } | null> {
  if (hops > 3) return null
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(4000),
    headers: { accept, 'user-agent': 'ConcordLinkPreview/1.0' }
  })
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) return null
    const next = await isSafeUrl(new URL(location, url).toString())
    if (!next) return null
    return fetchText(next, accept, hops + 1)
  }
  if (!response.ok) return null
  return { url, body: await readLimited(response) }
}

async function fromYoutube(url: URL, id: string): Promise<UnfurlCard> {
  const image = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  let title = ''
  let author = ''
  try {
    const endpoint = new URL('https://www.youtube.com/oembed')
    endpoint.searchParams.set('url', url.toString())
    endpoint.searchParams.set('format', 'json')
    const loaded = await fetchText(endpoint, 'application/json')
    if (loaded) {
      const data = JSON.parse(loaded.body) as { title?: unknown; author_name?: unknown }
      if (typeof data.title === 'string') title = data.title
      if (typeof data.author_name === 'string') author = data.author_name
    }
  } catch {
    /* a miniatura segue sem o título */
  }
  return {
    url: url.toString(),
    kind: 'youtube',
    title: clip(title, 140),
    description: clip(author, 240),
    image,
    siteName: 'YouTube'
  }
}

async function fromHtml(url: URL, kind: UnfurlCard['kind']): Promise<UnfurlCard | null> {
  const loaded = await fetchText(url, 'text/html')
  if (!loaded) return null
  const html = loaded.body
  const imageRaw = meta(html, 'og:image')
  let image = ''
  if (imageRaw) {
    try {
      const absolute = new URL(imageRaw, loaded.url).toString()
      if ((await isSafeUrl(absolute)) && absolute.length <= 500) image = absolute
    } catch {
      image = ''
    }
  }
  return {
    url: url.toString(),
    kind,
    title: clip(meta(html, 'og:title') || meta(html, 'twitter:title'), 140),
    description: clip(meta(html, 'og:description') || meta(html, 'description'), 240),
    image,
    siteName: clip(meta(html, 'og:site_name') || loaded.url.hostname.replace(/^www\./, ''), 80)
  }
}

export async function unfurl(raw: string, ip: string): Promise<UnfurlCard | { error: string; status: number }> {
  if (!allowedRate(ip)) return { error: 'Muitas consultas de link. Tente de novo em instantes.', status: 429 }
  const url = await isSafeUrl(raw.trim())
  if (!url) return { error: 'Link inválido.', status: 400 }
  const key = url.toString()
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.card
  if (cached) cache.delete(key)
  const kind = kindOf(url)
  try {
    if (kind === 'image') {
      return remember(key, { url: key, kind, title: '', description: '', image: key, siteName: url.hostname.replace(/^www\./, '') })
    }
    const video = youtubeId(url)
    if (video) return remember(key, await fromYoutube(url, video))
    const card = await fromHtml(url, kind)
    if (!card || (!card.title && !card.image && !card.description)) return { error: 'Sem prévia para este link.', status: 422 }
    return remember(key, card)
  } catch {
    return { error: 'Não foi possível ler o link.', status: 422 }
  }
}

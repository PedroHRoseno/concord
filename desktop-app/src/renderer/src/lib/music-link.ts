import type { MusicProvider } from '@renderer/types'

export interface ResolvedMusic {
  sourceUrl: string
  provider: MusicProvider
  videoId: string
  title: string
  artist: string
  artwork: string
}

function httpBase(signalingUrl: string): string {
  const url = new URL(signalingUrl)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function videoId(value: string): string | null {
  return /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null
}

export function youtubeVideoId(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (host === 'youtu.be') return videoId(url.pathname.split('/').filter(Boolean)[0] ?? '')
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return videoId(url.searchParams.get('v') ?? '')
    const parts = url.pathname.split('/').filter(Boolean)
    if ((parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') && parts[1]) return videoId(parts[1])
  }
  return null
}

function spotifyTrack(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.hostname.toLowerCase() !== 'open.spotify.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  const track = parts[0] === 'track' ? parts[1] : parts[0]?.startsWith('intl-') && parts[1] === 'track' ? parts[2] : ''
  return track && /^[A-Za-z0-9]+$/.test(track) ? track : null
}

async function youtubeMeta(id: string): Promise<{ title: string; artist: string; artwork: string }> {
  const page = `https://www.youtube.com/watch?v=${id}`
  const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(page)}&format=json`)
  if (!response.ok) return { title: 'YouTube', artist: '', artwork: '' }
  const data = (await response.json()) as { title?: string; author_name?: string; thumbnail_url?: string }
  return {
    title: (data.title || 'YouTube').slice(0, 140),
    artist: (data.author_name || '').slice(0, 140),
    artwork: typeof data.thumbnail_url === 'string' && data.thumbnail_url.startsWith('https://') ? data.thumbnail_url : ''
  }
}

async function spotifyMeta(signalingUrl: string, page: string): Promise<{ title: string; artist: string; artwork: string }> {
  const response = await fetch(`${httpBase(signalingUrl)}/unfurl?url=${encodeURIComponent(page)}`)
  if (!response.ok) throw new Error('Não foi possível ler o link do Spotify.')
  const data = (await response.json()) as { title?: string; description?: string; image?: string }
  const title = (data.title || '').replace(/\s+/g, ' ').trim()
  const description = (data.description || '').replace(/\s+/g, ' ').trim()
  const artist = description.split('·')[0]?.trim() || ''
  if (!title) throw new Error('O Spotify não devolveu o nome da faixa.')
  return {
    title: title.slice(0, 140),
    artist: artist && artist !== title ? artist.slice(0, 140) : '',
    artwork: typeof data.image === 'string' && data.image.startsWith('https://') ? data.image : ''
  }
}

async function searchYoutube(signalingUrl: string, query: string): Promise<{ videoId: string; title: string }> {
  const response = await fetch(`${httpBase(signalingUrl)}/music-search?q=${encodeURIComponent(query)}`)
  const data = (await response.json().catch(() => null)) as { videoId?: string; title?: string; error?: string } | null
  if (!response.ok || !data?.videoId || !videoId(data.videoId)) {
    throw new Error(data?.error || 'Não encontrei essa música no YouTube.')
  }
  return { videoId: data.videoId, title: (data.title || query).slice(0, 140) }
}

export async function resolveMusicLink(raw: string, signalingUrl: string): Promise<ResolvedMusic> {
  const sourceUrl = raw.trim()
  if (!/^https:\/\//.test(sourceUrl)) throw new Error('Cole um link https do YouTube ou do Spotify.')
  const youtube = youtubeVideoId(sourceUrl)
  if (youtube) {
    const meta = await youtubeMeta(youtube)
    return { sourceUrl, provider: 'youtube', videoId: youtube, ...meta }
  }
  if (!spotifyTrack(sourceUrl)) throw new Error('Use o link de uma faixa do YouTube ou do Spotify.')
  const spotify = await spotifyMeta(signalingUrl, sourceUrl)
  const found = await searchYoutube(signalingUrl, `${spotify.title} ${spotify.artist}`.trim())
  return {
    sourceUrl,
    provider: 'spotify',
    videoId: found.videoId,
    title: spotify.title || found.title,
    artist: spotify.artist,
    artwork: spotify.artwork
  }
}

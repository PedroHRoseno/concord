import { ipcMain, net, protocol } from 'electron'

const INSTANCES = [
  'https://inv.nadeko.net/api/v1/videos/',
  'https://invidious.nerdvpn.de/api/v1/videos/',
  'https://pipedapi.kavin.rocks/streams/',
  'https://pipedapi.adminforge.de/streams/'
]

function allowedAudioHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'googlevideo.com' || host.endsWith('.googlevideo.com')
}

function audioUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const body = payload as {
    audioStreams?: Array<{ url?: string; mimeType?: string }>
    adaptiveFormats?: Array<{ url?: string; type?: string }>
  }
  const piped = body.audioStreams?.find((item) => typeof item.url === 'string' && item.mimeType?.startsWith('audio'))
  if (piped?.url) return piped.url
  const adaptive = body.adaptiveFormats?.find((item) => typeof item.url === 'string' && item.type?.startsWith('audio'))
  return adaptive?.url ?? body.audioStreams?.find((item) => typeof item.url === 'string')?.url ?? null
}

async function resolveAudio(videoId: string): Promise<string | null> {
  for (const base of INSTANCES) {
    try {
      const response = await net.fetch(`${base}${videoId}`)
      if (!response.ok) continue
      const found = audioUrl(await response.json())
      if (!found) continue
      const upstream = new URL(found)
      if (upstream.protocol === 'https:' && allowedAudioHost(upstream.hostname)) return upstream.toString()
    } catch {
      continue
    }
  }
  return null
}

export function registerMusic(): void {
  protocol.handle('concord-media', async (request) => {
    let upstream: URL
    try {
      const target = new URL(request.url).searchParams.get('src') ?? ''
      upstream = new URL(target)
    } catch {
      return new Response('bad', { status: 400 })
    }
    if (upstream.protocol !== 'https:' || !allowedAudioHost(upstream.hostname)) {
      return new Response('blocked', { status: 403 })
    }
    const headers = new Headers()
    const range = request.headers.get('range')
    if (range) headers.set('range', range)
    try {
      const response = await net.fetch(upstream.toString(), { headers })
      const out = new Headers()
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const value = response.headers.get(name)
        if (value) out.set(name, value)
      }
      out.set('access-control-allow-origin', '*')
      return new Response(response.body, { status: response.status, headers: out })
    } catch {
      return new Response('upstream', { status: 502 })
    }
  })

  ipcMain.handle('music:audio-url', async (_event, videoId: unknown) => {
    if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
    return resolveAudio(videoId)
  })
}

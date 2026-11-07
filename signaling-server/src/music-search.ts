const WINDOW_MS = 60_000
const MAX_HITS = 20
const hits = new Map<string, number[]>()

export function allowMusicSearch(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((at) => now - at < WINDOW_MS)
  if (recent.length >= MAX_HITS) {
    hits.set(ip, recent)
    return false
  }
  recent.push(now)
  hits.set(ip, recent)
  return true
}

function clip(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > 140 ? clean.slice(0, 139) + '…' : clean
}

/** Busca o primeiro vídeo do YouTube para um título que o cliente já extraiu. */
export async function searchYoutube(query: string): Promise<{ videoId: string; title: string } | null> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, 180)
  if (q.length < 2) return null
  const response = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Concord/1.9' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20241126.01.00', hl: 'pt', gl: 'BR' } },
      query: q
    }),
    signal: AbortSignal.timeout(8000)
  })
  if (!response.ok) return null
  const text = await response.text()
  const videoId = /"videoId":"([A-Za-z0-9_-]{11})"/.exec(text)?.[1]
  if (!videoId) return null
  const rawTitle = /"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/.exec(text)?.[1]
  let title = q
  if (rawTitle) {
    try {
      title = JSON.parse(`"${rawTitle}"`) as string
    } catch {
      title = rawTitle
    }
  }
  return { videoId, title: clip(title) }
}

import type { TurnCredentials } from '@renderer/types'

const BASE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]

export function buildIceServers(turn: TurnCredentials | null, remote: RTCIceServer[] = []): RTCIceServer[] {
  const servers: RTCIceServer[] = [...BASE_SERVERS]
  const manual = manualTurn(turn)
  if (manual) {
    servers.push(manual)
    return servers
  }
  servers.push(...remote)
  return servers
}

function manualTurn(turn: TurnCredentials | null): RTCIceServer | null {
  if (!turn) return null
  const urls = turn.urls
    .trim()
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (!urls.length || !turn.username.trim() || !turn.credential.trim()) return null
  return { urls, username: turn.username.trim(), credential: turn.credential.trim() }
}

export function normalizeTurn(turn: TurnCredentials): TurnCredentials | null {
  if (!turn.urls.trim() || !turn.username.trim() || !turn.credential.trim()) return null
  return {
    urls: turn.urls.trim(),
    username: turn.username.trim(),
    credential: turn.credential.trim()
  }
}

/** Busca as credenciais TURN temporárias no servidor de sinalização. Falhas devolvem lista vazia. */
export async function fetchRemoteIceServers(signalingUrl: string): Promise<RTCIceServer[]> {
  try {
    const url = new URL(signalingUrl)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = '/turn'
    url.search = ''
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) })
    if (!response.ok) return []
    const data = (await response.json()) as { iceServers?: unknown }
    if (!Array.isArray(data.iceServers)) return []
    return data.iceServers.filter(
      (item): item is RTCIceServer => Boolean(item) && typeof item === 'object' && 'urls' in (item as object)
    )
  } catch {
    return []
  }
}

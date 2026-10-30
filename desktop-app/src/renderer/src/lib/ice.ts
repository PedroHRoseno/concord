import type { TurnCredentials } from '@renderer/types'

export function buildIceServers(turn: TurnCredentials | null): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
  if (!turn) return servers
  const urls = turn.urls
    .trim()
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  if (!urls.length || !turn.username.trim() || !turn.credential.trim()) return servers
  servers.push({
    urls,
    username: turn.username.trim(),
    credential: turn.credential.trim()
  })
  return servers
}

export function normalizeTurn(turn: TurnCredentials): TurnCredentials | null {
  if (!turn.urls.trim() || !turn.username.trim() || !turn.credential.trim()) return null
  return {
    urls: turn.urls.trim(),
    username: turn.username.trim(),
    credential: turn.credential.trim()
  }
}

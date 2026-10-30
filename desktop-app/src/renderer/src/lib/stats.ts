export interface StreamStats {
  width: number
  height: number
  fps: number
  bitrateMbps: number
  codec: string
  rttMs: number | null
}

const samples = new Map<string, { bytes: number; timestamp: number }>()

function readNumber(stat: RTCStats, key: string): number | null {
  const value = (stat as RTCStats & Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(stat: RTCStats, key: string): string | null {
  const value = (stat as RTCStats & Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

export async function readStreamStats(
  pc: RTCPeerConnection,
  direction: 'inbound' | 'outbound',
  key: string
): Promise<StreamStats | null> {
  const report = await pc.getStats()
  const entries = [...report.values()]
  const codecs = new Map<string, string>()
  let rttMs: number | null = null

  for (const stat of entries) {
    if (stat.type === 'codec') {
      const mime = readString(stat, 'mimeType')
      if (mime) codecs.set(stat.id, mime)
    }
    if (stat.type === 'candidate-pair' && readString(stat, 'state') === 'succeeded') {
      const nominated = (stat as RTCStats & { nominated?: boolean; selected?: boolean }).nominated
      const selected = (stat as RTCStats & { selected?: boolean }).selected
      if (nominated || selected) {
        const rtt = readNumber(stat, 'currentRoundTripTime')
        if (rtt !== null) rttMs = Math.round(rtt * 1000)
      }
    }
  }

  const video = entries.find(
    (stat) => stat.type === `${direction}-rtp` && readString(stat, 'kind') === 'video'
  )
  if (!video) return null
  const bytes = readNumber(video, direction === 'inbound' ? 'bytesReceived' : 'bytesSent') ?? 0
  const timestamp = video.timestamp
  const previous = samples.get(key)
  let bitrateMbps = 0
  if (previous && bytes >= previous.bytes && timestamp > previous.timestamp) {
    bitrateMbps = ((bytes - previous.bytes) * 8) / (timestamp - previous.timestamp) / 1000
  }
  samples.set(key, { bytes, timestamp })

  const codecId = readString(video, 'codecId')
  const mime = codecId ? codecs.get(codecId) : undefined
  const codec = mime ? mime.replace(/^video\//i, '').toUpperCase() : '—'

  return {
    width: readNumber(video, 'frameWidth') ?? 0,
    height: readNumber(video, 'frameHeight') ?? 0,
    fps: Math.round(readNumber(video, 'framesPerSecond') ?? 0),
    bitrateMbps,
    codec,
    rttMs
  }
}

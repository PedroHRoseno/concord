export type ResolutionPreset = '720p' | '1080p' | '1440p' | 'native'
export type ContentHint = 'motion' | 'detail'
export type StreamType = 'screen' | 'webcam'

export interface StreamMeta {
  streamId: string
  streamType: StreamType
  sourceName: string
  resolution: ResolutionPreset
  fps: 30 | 60
  maxBitrate: number
  audio: boolean
  contentHint: ContentHint
  audioBitrate: number
}

export interface WatcherInfo {
  peerId: string
  displayName: string
}

export interface PeerInfo {
  peerId: string
  displayName: string
  streams: StreamMeta[]
  watchers: Array<{ streamId: string; peerId: string; displayName: string }>
}

export interface SessionDescriptionInit {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback'
  sdp?: string
}

export interface IceCandidateInit {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export interface SignalPayload {
  kind: 'offer' | 'answer' | 'ice'
  streamId: string
  broadcasterId: string
  viewerId: string
  description?: SessionDescriptionInit
  candidate?: IceCandidateInit
}

export type ClientMessage =
  | { type: 'join'; roomId: string; peerId: string; displayName: string }
  | { type: 'leave' }
  | { type: 'signal'; to: string; payload: SignalPayload }
  | { type: 'stream-meta'; streamId: string; meta: StreamMeta | null }
  | { type: 'watch'; streamId: string }
  | { type: 'unwatch'; streamId: string }
  | { type: 'ping' }

export type ServerMessage =
  | { type: 'joined'; peerId: string; peers: PeerInfo[] }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; peerId: string }
  | { type: 'signal'; from: string; payload: SignalPayload }
  | { type: 'stream-meta'; peerId: string; streamId: string; meta: StreamMeta | null }
  | { type: 'watch'; streamId: string; viewerId: string }
  | { type: 'unwatch'; streamId: string; viewerId: string }
  | { type: 'watcher-joined'; streamId: string; broadcasterId: string; watcher: WatcherInfo }
  | { type: 'watcher-left'; streamId: string; broadcasterId: string; peerId: string }
  | { type: 'pong' }
  | { type: 'error'; message: string }

const RESOLUTIONS = new Set<ResolutionPreset>(['720p', '1080p', '1440p', 'native'])
const STREAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(screen|webcam)$/i

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function isStreamId(value: unknown): value is string {
  return typeof value === 'string' && STREAM_ID_RE.test(value)
}

export function isStreamMeta(value: unknown): value is StreamMeta {
  if (!value || typeof value !== 'object') return false
  const meta = value as StreamMeta
  return (
    isStreamId(meta.streamId) &&
    (meta.streamType === 'screen' || meta.streamType === 'webcam') &&
    meta.streamId.endsWith(`:${meta.streamType}`) &&
    typeof meta.sourceName === 'string' &&
    meta.sourceName.trim().length > 0 &&
    meta.sourceName.length <= 180 &&
    RESOLUTIONS.has(meta.resolution) &&
    (meta.fps === 30 || meta.fps === 60) &&
    inRange(meta.maxBitrate, 1_000_000, 50_000_000) &&
    typeof meta.audio === 'boolean' &&
    (meta.contentHint === 'motion' || meta.contentHint === 'detail') &&
    inRange(meta.audioBitrate, 64_000, 320_000)
  )
}

export function isSignalPayload(value: unknown): value is SignalPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as SignalPayload
  if (payload.kind !== 'offer' && payload.kind !== 'answer' && payload.kind !== 'ice') return false
  if (!isStreamId(payload.streamId)) return false
  if (typeof payload.broadcasterId !== 'string' || typeof payload.viewerId !== 'string') return false
  if (payload.broadcasterId.length < 1 || payload.broadcasterId.length > 80) return false
  if (payload.viewerId.length < 1 || payload.viewerId.length > 80) return false
  return true
}

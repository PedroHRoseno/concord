export type ResolutionPreset = '720p' | '1080p' | '1440p' | 'native'
export type ContentHint = 'motion' | 'detail'
export type StreamType = 'screen' | 'webcam' | 'voice' | 'music'
export type Feature = 'voice' | 'chat' | 'music'
export type MusicProvider = 'youtube' | 'spotify'

export interface MusicTrack {
  id: string
  sourceUrl: string
  provider: MusicProvider
  videoId: string
  title: string
  artist: string
  artwork: string
  addedBy: string
  addedByName: string
}

export interface MusicState {
  current: MusicTrack | null
  queue: MusicTrack[]
  votes: string[]
  needed: number
}

export interface ChatMessage {
  id: string
  peerId: string
  displayName: string
  text: string
  image?: string
  ts: number
}

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

export interface PublicProfile {
  avatarDataUrl: string
  accentColor: string
  customStatus: string
}

export interface PeerInfo {
  peerId: string
  displayName: string
  profile: PublicProfile
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

export interface RoomMemberCard {
  peerId: string
  name: string
  avatar: string
  accentColor: string
  statusText: string
  isSpeaking: boolean
  isMuted: boolean
}

export interface RoomCard {
  roomId: string
  label: string
  members: RoomMemberCard[]
  activity: { screens: Array<{ sourceName: string }>; cameras: number }
}

export type ClientMessage =
  | { type: 'join'; roomId: string; peerId: string; displayName: string; profile?: PublicProfile; features?: Feature[]; unlisted?: boolean }
  | { type: 'watch-rooms' }
  | { type: 'voice-state'; speaking: boolean; muted: boolean }
  | { type: 'chat'; text?: string; image?: string }
  | { type: 'update-profile'; displayName: string; profile: PublicProfile }
  | { type: 'leave' }
  | { type: 'signal'; to: string; payload: SignalPayload }
  | { type: 'stream-meta'; streamId: string; meta: StreamMeta | null }
  | { type: 'watch'; streamId: string }
  | { type: 'unwatch'; streamId: string }
  | { type: 'stream-preview'; streamId: string; image: string; to?: string }
  | { type: 'add-music'; sourceUrl: string; provider: MusicProvider; videoId: string; title: string; artist: string; artwork: string }
  | { type: 'vote-skip' }
  | { type: 'force-skip' }
  | { type: 'music-ended'; trackId: string }
  | { type: 'sync-time'; trackId: string; currentTime: number }
  | { type: 'ping' }

export type ServerMessage =
  | { type: 'joined'; peerId: string; peers: PeerInfo[] }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; peerId: string }
  | { type: 'profile-updated'; peerId: string; displayName: string; profile: PublicProfile }
  | { type: 'signal'; from: string; payload: SignalPayload }
  | { type: 'stream-meta'; peerId: string; streamId: string; meta: StreamMeta | null }
  | { type: 'watch'; streamId: string; viewerId: string }
  | { type: 'unwatch'; streamId: string; viewerId: string }
  | { type: 'watcher-joined'; streamId: string; broadcasterId: string; watcher: WatcherInfo }
  | { type: 'watcher-left'; streamId: string; broadcasterId: string; peerId: string }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat-history'; messages: ChatMessage[] }
  | { type: 'pong' }
  | { type: 'rooms'; rooms: RoomCard[] }
  | { type: 'rooms-updated'; rooms: RoomCard[] }
  | { type: 'stream-preview'; peerId: string; streamId: string; image: string }
  | { type: 'music'; state: MusicState }
  | { type: 'play-music'; trackId: string; videoId: string; sourceUrl: string; addedBy: string; currentTime: number }
  | { type: 'sync-time'; trackId: string; currentTime: number }
  | { type: 'error'; message: string }

const AVATAR_LIMIT = 12_000
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function sanitizeProfile(value: unknown): PublicProfile {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const avatar = typeof raw.avatarDataUrl === 'string' ? raw.avatarDataUrl : ''
  const allowed = avatar.startsWith('data:image/webp;base64,') || avatar.startsWith('data:image/svg+xml')
  const color = typeof raw.accentColor === 'string' && COLOR_RE.test(raw.accentColor) ? raw.accentColor : '#5865F2'
  const status = typeof raw.customStatus === 'string' ? raw.customStatus.trim().slice(0, 40) : ''
  return {
    avatarDataUrl: allowed && avatar.length <= AVATAR_LIMIT ? avatar : '',
    accentColor: color,
    customStatus: status
  }
}

const RESOLUTIONS = new Set<ResolutionPreset>(['720p', '1080p', '1440p', 'native'])
const STREAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(screen|webcam|voice|music)$/i
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function isStreamId(value: unknown): value is string {
  return typeof value === 'string' && STREAM_ID_RE.test(value)
}

export function isStreamMeta(value: unknown): value is StreamMeta {
  if (!value || typeof value !== 'object') return false
  const meta = value as StreamMeta
  if (meta.streamType === 'voice' || meta.streamType === 'music') {
    return (
      isStreamId(meta.streamId) &&
      meta.streamId.endsWith(`:${meta.streamType}`) &&
      typeof meta.sourceName === 'string' &&
      meta.sourceName.length <= 180 &&
      inRange(meta.audioBitrate, 16_000, 320_000)
    )
  }
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

export const CHAT_TEXT_MAX = 2000
export const CHAT_IMAGE_MAX = 90_000
export const PREVIEW_IMAGE_MAX = 48_000
const IMAGE_PREFIX = 'data:image/webp;base64,'

export function parseFeatures(value: unknown): Set<Feature> {
  const set = new Set<Feature>()
  if (!Array.isArray(value)) return set
  for (const item of value) if (item === 'voice' || item === 'chat' || item === 'music') set.add(item)
  return set
}

export function validateChat(
  text: unknown,
  image: unknown
): { ok: true; text: string; image?: string } | { ok: false; error: string } {
  const body = typeof text === 'string' ? text.trim() : ''
  if (body.length > CHAT_TEXT_MAX) return { ok: false, error: 'Mensagem longa demais (máx. 2000 caracteres).' }
  let img: string | undefined
  if (image !== undefined && image !== null && image !== '') {
    if (typeof image !== 'string' || !image.startsWith(IMAGE_PREFIX) || !/^[A-Za-z0-9+/=]+$/.test(image.slice(IMAGE_PREFIX.length))) {
      return { ok: false, error: 'Imagem inválida. Use WebP.' }
    }
    if (image.length > CHAT_IMAGE_MAX) return { ok: false, error: 'Imagem grande demais.' }
    img = image
  }
  if (!body && !img) return { ok: false, error: 'Mensagem vazia.' }
  return { ok: true, text: body, image: img }
}

export function parseMusicRequest(
  value: Record<string, unknown>
): { ok: true; sourceUrl: string; provider: MusicProvider; videoId: string; title: string; artist: string; artwork: string } | { ok: false; error: string } {
  const sourceUrl = typeof value.sourceUrl === 'string' ? value.sourceUrl.trim() : ''
  const provider = value.provider === 'youtube' || value.provider === 'spotify' ? value.provider : null
  const videoId = typeof value.videoId === 'string' ? value.videoId : ''
  const title = typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim() : ''
  const artist = typeof value.artist === 'string' ? value.artist.replace(/\s+/g, ' ').trim() : ''
  const artwork = typeof value.artwork === 'string' ? value.artwork.trim() : ''
  if (!provider) return { ok: false, error: 'Origem da música inválida.' }
  if (!VIDEO_ID_RE.test(videoId)) return { ok: false, error: 'Vídeo do YouTube inválido.' }
  if (!/^https:\/\/.{1,480}$/.test(sourceUrl)) return { ok: false, error: 'Link da música inválido.' }
  if (title.length < 1 || title.length > 140) return { ok: false, error: 'Título da música inválido.' }
  if (artist.length > 140) return { ok: false, error: 'Artista da música inválido.' }
  if (artwork && !/^https:\/\/.{1,400}$/.test(artwork)) return { ok: false, error: 'Capa da música inválida.' }
  return { ok: true, sourceUrl, provider, videoId, title, artist, artwork }
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

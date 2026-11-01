export type ResolutionPreset = '720p' | '1080p' | '1440p' | 'native'
export type ContentHint = 'motion' | 'detail'
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
export type StreamType = 'screen' | 'webcam'
export type AudioSourceMode = 'none' | 'system' | 'window' | 'device' | 'tab'

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
  avatarDataUrl?: string
  accentColor?: string
}

export interface PublicProfile {
  avatarDataUrl: string
  accentColor: string
  customStatus: string
}

export interface PeerInfo {
  peerId: string
  displayName: string
  profile?: PublicProfile
  streams: StreamMeta[]
  watchers: Array<{ streamId: string; peerId: string; displayName: string }>
}

export interface SignalPayload {
  kind: 'offer' | 'answer' | 'ice'
  streamId: string
  broadcasterId: string
  viewerId: string
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

export type ClientMessage =
  | { type: 'join'; roomId: string; peerId: string; displayName: string; profile?: PublicProfile }
  | { type: 'update-profile'; displayName: string; profile: PublicProfile }
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
  | { type: 'profile-updated'; peerId: string; displayName: string; profile: PublicProfile }
  | { type: 'signal'; from: string; payload: SignalPayload }
  | { type: 'stream-meta'; peerId: string; streamId: string; meta: StreamMeta | null }
  | { type: 'watch'; streamId: string; viewerId: string }
  | { type: 'unwatch'; streamId: string; viewerId: string }
  | { type: 'watcher-joined'; streamId: string; broadcasterId: string; watcher: WatcherInfo }
  | { type: 'watcher-left'; streamId: string; broadcasterId: string; peerId: string }
  | { type: 'pong' }
  | { type: 'error'; message: string }

export interface TurnCredentials {
  urls: string
  username: string
  credential: string
}

export interface CaptureSettings {
  sourceId: string
  sourceName: string
  audioMode: AudioSourceMode
  audioDeviceId: string
  resolution: ResolutionPreset
  fps: 30 | 60
  maxBitrate: number
  audioBitrate: number
  contentHint: ContentHint
}

export interface RemoteStreamView {
  streamId: string
  meta: StreamMeta
  media: MediaStream | null
  watching: boolean
  pc: RTCPeerConnection | null
  watchers: WatcherInfo[]
  reconnecting: boolean
}

export interface PeerView {
  peerId: string
  displayName: string
  profile: PublicProfile
  streams: RemoteStreamView[]
}

export interface LocalPublication {
  streamId: string
  meta: StreamMeta
  media: MediaStream
  watchers: WatcherInfo[]
  pc: RTCPeerConnection | null
  reconnecting: boolean
}

export interface UserProfile extends PublicProfile {
  displayName: string
}

export interface LobbyInput {
  displayName: string
  roomId: string
  signalingUrl: string
  turn: TurnCredentials
  profile: UserProfile
}

export interface WebcamSettings {
  deviceId: string
  deviceLabel: string
  resolution: '720p' | '1080p'
}

export const VIDEO_BITRATES = [
  { value: 4_000_000, label: '4 Mbps' },
  { value: 8_000_000, label: '8 Mbps' },
  { value: 12_000_000, label: '12 Mbps' },
  { value: 20_000_000, label: '20 Mbps' },
  { value: 30_000_000, label: '30 Mbps' },
  { value: 50_000_000, label: '50 Mbps' }
] as const

export const AUDIO_BITRATES = [
  { value: 128_000, label: '128 kbps' },
  { value: 256_000, label: '256 kbps' }
] as const

export const RESOLUTION_OPTIONS: Array<{
  id: ResolutionPreset
  label: string
  width: number | null
  height: number | null
}> = [
  { id: '720p', label: '720p', width: 1280, height: 720 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p', width: 2560, height: 1440 },
  { id: 'native', label: 'Nativa (Source)', width: null, height: null }
]

export function streamIdFor(peerId: string, streamType: StreamType): string {
  return `${peerId}:${streamType}`
}

export function toStreamMeta(settings: CaptureSettings, streamId: string, streamType: StreamType): StreamMeta {
  const sourceName = settings.sourceName.trim().slice(0, 180)
  return {
    streamId,
    streamType,
    sourceName: sourceName || (streamType === 'webcam' ? 'Webcam' : 'Tela'),
    resolution: settings.resolution,
    fps: settings.fps,
    maxBitrate: settings.maxBitrate,
    audio: settings.audioMode !== 'none',
    contentHint: settings.contentHint,
    audioBitrate: settings.audioBitrate
  }
}

export function formatBitrateCap(bps: number): string {
  return `${bps / 1_000_000} Mbps`
}

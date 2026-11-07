import { buildIceServers, fetchRemoteIceServers } from '@renderer/lib/ice'
import { attachRemoteMusic, detachRemoteMusic } from '@renderer/lib/jukebox'
import { attachRemoteVoice, detachRemoteVoice, renameRemoteVoice, VOICE_BITRATE } from '@renderer/lib/voice'
import { publicProfileOf, sanitizeProfile } from '@renderer/lib/profile'
import {
  playStreamStartSound,
  playStreamStopSound,
  playUserJoinSound,
  playUserLeaveSound,
  playViewerJoinedMyStreamSound
} from '@renderer/utils/soundEffects'
import { applyVideoEncoding, preferOpus, preferVideoCodecs, tuneOpus, tuneOpusVoice } from '@renderer/lib/sdp'
import { SignalingClient } from '@renderer/lib/signaling'
import {
  streamIdFor,
  toStreamMeta,
  type CaptureSettings,
  type ChatMessage,
  type ConnectionStatus,
  type LocalPublication,
  type PeerView,
  type ServerMessage,
  type SignalPayload,
  type StreamMeta,
  type StreamType,
  type TurnCredentials,
  type PublicProfile,
  type MusicState,
  type MusicTrack,
  type RoomCard,
  type ScreenGhost,
  type WatcherInfo
} from '@renderer/types'

export interface MeshSnapshot {
  peers: PeerView[]
  ghosts: ScreenGhost[]
}

export interface MeshEvents {
  onStatus: (status: ConnectionStatus) => void
  onSnapshot: (snapshot: MeshSnapshot) => void
  onLocals: (publications: LocalPublication[]) => void
  onError: (message: string) => void
  onChat: (message: ChatMessage) => void
  onChatHistory: (messages: ChatMessage[]) => void
  onRooms: (rooms: RoomCard[]) => void
  onMusic: (state: MusicState) => void
  onLatency: (ms: number | null) => void
}

interface SessionOptions {
  url: string
  roomId: string
  peerId: string
  displayName: string
  profile: PublicProfile
  turn: TurnCredentials | null
  unlisted?: boolean
  events: MeshEvents
}

interface RemotePeer {
  peerId: string
  displayName: string
  profile: PublicProfile
  streams: Map<string, StreamMeta>
  watchers: Map<string, WatcherInfo[]>
}

interface LocalPub {
  streamId: string
  streamType: StreamType
  stream: MediaStream
  settings: CaptureSettings
  gen: number
}

interface PeerLink {
  key: string
  pc: RTCPeerConnection
  role: 'host' | 'viewer'
  streamId: string
  broadcasterId: string
  viewerId: string
  remotePeerId: string
  videoSender: RTCRtpSender | null
  audioSender: RTCRtpSender | null
  pendingCandidates: RTCIceCandidateInit[]
  recoveryTimer: number
  attempts: number
  recovering: boolean
}

function linkKey(streamId: string, viewerId: string): string {
  return `${streamId}>${viewerId}`
}

/** O cartão borrado da grade só precisa de um retrato ocasional. */
const PREVIEW_REFRESH_MS = 5 * 60 * 1000

function groupWatchers(
  rows: Array<{ streamId: string; peerId: string; displayName: string }>
): Map<string, WatcherInfo[]> {
  const grouped = new Map<string, WatcherInfo[]>()
  for (const row of rows) {
    const list = grouped.get(row.streamId) ?? []
    list.push({ peerId: row.peerId, displayName: row.displayName })
    grouped.set(row.streamId, list)
  }
  return grouped
}

export class MeshSession {
  private readonly socket: SignalingClient
  private iceServers: RTCIceServer[]
  private readonly turn: TurnCredentials | null
  private readonly url: string
  private readonly events: MeshEvents
  private readonly peerId: string
  private readonly roomId: string
  private displayName: string
  private profile: PublicProfile
  private peers = new Map<string, RemotePeer>()
  private links = new Map<string, PeerLink>()
  private remoteStreams = new Map<string, MediaStream>()
  private earlyIce = new Map<string, RTCIceCandidateInit[]>()
  private watching = new Set<string>()
  private hiddenWebcams = new Set<string>()
  private hiddenScreens = new Set<string>()
  private watchMemory = new Map<string, number>()
  private ghosts = new Map<string, ScreenGhost>()
  private ghostTimer: number | null = null
  private frames = new Map<string, string>()
  private previews = new Map<string, string>()
  private slotByStream = new Map<string, string>()
  private previewTimer: number | null = null
  private previewVideo: HTMLVideoElement | null = null
  private lastPreviewImage = ''
  private lastPreviewStreamId = ''
  private hostJobs = new Map<string, Promise<void>>()
  private locals = new Map<string, LocalPub>()
  private localWatchers = new Map<string, WatcherInfo[]>()
  private rewatchTried = new Set<string>()
  private pendingRewatch = new Set<string>()
  private silent: { context: AudioContext; track: MediaStreamTrack } | null = null
  private disposed = false
  private captureActive = false
  private readonly unlisted: boolean
  private voiceState: { speaking: boolean; muted: boolean } | null = null

  constructor(options: SessionOptions) {
    this.events = options.events
    this.peerId = options.peerId
    this.roomId = options.roomId
    this.displayName = options.displayName
    this.profile = options.profile
    this.turn = options.turn
    this.unlisted = options.unlisted === true
    this.url = options.url
    this.iceServers = buildIceServers(options.turn)
    this.socket = new SignalingClient(options.url)
    this.socket.onStatus = (status) => {
      if (!this.disposed) this.events.onStatus(status)
    }
    this.socket.onLatency = (ms) => {
      if (!this.disposed) this.events.onLatency(ms)
    }
    this.socket.onOpen = () => {
      if (this.disposed) return
      this.socket.send({
        type: 'join',
        roomId: this.roomId,
        peerId: this.peerId,
        displayName: this.displayName,
        profile: this.profile,
        features: ['voice', 'chat', 'music'],
        unlisted: this.unlisted
      })
      this.socket.send({ type: 'watch-rooms' })
      if (this.voiceState) this.socket.send({ type: 'voice-state', ...this.voiceState })
    }
    this.socket.onClose = () => {
      if (this.disposed) return
      this.handleSocketDown()
    }
    this.socket.onMessage = (message) => {
      void this.handleMessage(message)
    }
  }

  start(): void {
    void this.init()
  }

  private async init(): Promise<void> {
    const remote = await fetchRemoteIceServers(this.url)
    if (this.disposed) return
    if (remote.length > 0) this.iceServers = buildIceServers(this.turn, remote)
    this.socket.start()
  }

  setVoiceState(speaking: boolean, muted: boolean): void {
    if (this.voiceState?.speaking === speaking && this.voiceState.muted === muted) return
    this.voiceState = { speaking, muted }
    this.socket.send({ type: 'voice-state', speaking, muted })
  }

  sendChat(text: string, image?: string): void {
    this.socket.send({ type: 'chat', text, image })
  }

  publishMusic(stream: MediaStream, title: string): void {
    const streamId = streamIdFor(this.peerId, 'music')
    const settings: CaptureSettings = {
      sourceId: 'music',
      sourceName: title.trim().slice(0, 180) || 'Música',
      audioMode: 'device',
      audioDeviceId: '',
      resolution: '720p',
      fps: 30,
      maxBitrate: 1_000_000,
      audioBitrate: 128_000,
      contentHint: 'detail'
    }
    const existing = this.locals.get(streamId)
    if (!existing) {
      this.begin(streamId, 'music', stream, settings)
      return
    }
    existing.gen += 1
    const previous = existing.stream
    existing.stream = stream
    existing.settings = settings
    const audio = stream.getAudioTracks().find((track) => track.readyState === 'live') ?? null
    for (const link of this.links.values()) {
      if (link.role !== 'host' || link.streamId !== streamId || !link.audioSender || !audio) continue
      void link.audioSender.replaceTrack(audio).catch((error) => console.warn('Falha ao trocar a música.', error))
    }
    previous.getTracks().forEach((track) => {
      if (track !== audio) track.stop()
    })
    this.socket.send({ type: 'stream-meta', streamId, meta: toStreamMeta(settings, streamId, 'music') })
  }

  addMusic(track: Omit<MusicTrack, 'id' | 'addedBy' | 'addedByName'>): void {
    this.socket.send({ type: 'add-music', ...track })
  }

  voteSkip(): void {
    this.socket.send({ type: 'vote-skip' })
  }

  forceSkip(): void {
    this.socket.send({ type: 'force-skip' })
  }

  musicEnded(trackId: string): void {
    this.socket.send({ type: 'music-ended', trackId })
  }

  async publishVoice(stream: MediaStream): Promise<void> {
    const streamId = streamIdFor(this.peerId, 'voice')
    if (this.locals.has(streamId)) this.stopStream('voice')
    const settings: CaptureSettings = {
      sourceId: 'voice',
      sourceName: 'Voz',
      audioMode: 'device',
      audioDeviceId: '',
      resolution: '720p',
      fps: 30,
      maxBitrate: 1_000_000,
      audioBitrate: VOICE_BITRATE,
      contentHint: 'detail'
    }
    this.begin(streamId, 'voice', stream, settings)
  }

  setVoiceEnabled(enabled: boolean): void {
    const pub = this.locals.get(streamIdFor(this.peerId, 'voice'))
    pub?.stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled
    })
  }

  /** Troca a track de voz sem parar o microfone cru nem renegociar a sala. */
  async replaceVoiceTrack(stream: MediaStream): Promise<void> {
    const streamId = streamIdFor(this.peerId, 'voice')
    const pub = this.locals.get(streamId)
    if (!pub) return
    pub.gen += 1
    pub.stream = stream
    const audio = stream.getAudioTracks().find((track) => track.readyState === 'live') ?? null
    for (const link of this.links.values()) {
      if (link.role !== 'host' || link.streamId !== streamId || !link.audioSender || !audio) continue
      try {
        await link.audioSender.replaceTrack(audio)
      } catch (error) {
        console.warn('Falha ao trocar a voz.', error)
      }
    }
    this.emitLocals()
  }

  /** Ignora o fim da track atual para a troca de câmera no celular não derrubar o link. */
  prepareCameraSwap(streamType: StreamType): boolean {
    const current = this.locals.get(streamIdFor(this.peerId, streamType))
    if (!current) return false
    current.gen += 1
    return true
  }

  async publish(stream: MediaStream, settings: CaptureSettings, streamType: StreamType): Promise<void> {
    const streamId = streamIdFor(this.peerId, streamType)
    const previous = this.locals.get(streamId)
    if (previous) await this.hotSwap(previous, stream, settings)
    else this.begin(streamId, streamType, stream, settings)
  }

  stopStream(streamType: StreamType): void {
    const streamId = streamIdFor(this.peerId, streamType)
    const current = this.locals.get(streamId)
    if (!current) return
    current.gen += 1
    this.locals.delete(streamId)
    this.localWatchers.delete(streamId)
    for (const key of [...this.links.keys()]) {
      const link = this.links.get(key)
      if (link?.role === 'host' && link.streamId === streamId) this.closeLink(key)
    }
    current.stream.getTracks().forEach((track) => track.stop())
    if (streamType === 'screen') this.stopPreviewLoop()
    if (streamType === 'screen' || streamType === 'webcam') playStreamStopSound()
    if (this.mediaLocals() === 0) this.releaseSilent()
    this.socket.send({ type: 'stream-meta', streamId, meta: null })
    this.setCaptureActive(this.mediaLocals() > 0)
    this.emitLocals()
    this.emit()
  }

  updateProfile(displayName: string, profile: PublicProfile): void {
    this.displayName = displayName
    this.profile = profile
    this.socket.send({ type: 'update-profile', displayName, profile })
  }

  watch(streamId: string): void {
    if (streamId.startsWith(`${this.peerId}:`)) return
    const owner = this.ownerOf(streamId)
    if (!owner?.streams.has(streamId)) return
    this.hiddenWebcams.delete(streamId)
    this.hiddenScreens.delete(streamId)
    this.watchMemory.delete(streamId)
    this.watching.add(streamId)
    this.socket.send({ type: 'watch', streamId })
    this.emit()
  }

  unwatch(streamId: string): void {
    if (streamId.endsWith(':webcam')) this.hiddenWebcams.add(streamId)
    this.dropGhost(streamId)
    this.watching.delete(streamId)
    this.watchMemory.delete(streamId)
    this.rewatchTried.delete(streamId)
    this.pendingRewatch.delete(streamId)
    this.socket.send({ type: 'unwatch', streamId })
    const owner = this.ownerOf(streamId)
    if (owner) this.closeLink(linkKey(streamId, this.peerId))
    this.remoteStreams.delete(streamId)
    this.emit()
  }

  hideScreen(streamId: string): void {
    this.hiddenScreens.add(streamId)
    this.dropGhost(streamId)
    if (this.watching.has(streamId)) this.unwatch(streamId)
    else this.emit()
  }

  noteFrame(streamId: string, image: string): void {
    if (!image.startsWith('data:image/webp;base64,') || image.length > 48_000) return
    this.frames.set(streamId, image)
    for (const ghost of this.ghosts.values()) {
      if (ghost.streamId === streamId && ghost.poster !== image) {
        ghost.poster = image
        this.emit()
        return
      }
    }
  }

  dispose(): void {
    for (const streamType of ['screen', 'webcam', 'voice', 'music'] as const) this.stopStream(streamType)
    this.stopPreviewLoop()
    if (this.ghostTimer !== null) window.clearInterval(this.ghostTimer)
    this.ghostTimer = null
    this.closeAllLinks()
    this.releaseSilent()
    this.socket.send({ type: 'leave' })
    this.disposed = true
    this.socket.stop()
  }

  private begin(streamId: string, streamType: StreamType, stream: MediaStream, settings: CaptureSettings): void {
    const pub: LocalPub = { streamId, streamType, stream, settings, gen: 1 }
    this.locals.set(streamId, pub)
    this.prepareVideo(stream, settings)
    this.bindEnded(pub)
    const meta = toStreamMeta(settings, streamId, streamType)
    this.socket.send({ type: 'stream-meta', streamId, meta })
    if (streamType === 'screen' || streamType === 'webcam') {
      this.setCaptureActive(true)
      playStreamStartSound()
    }
    if (streamType === 'screen') this.ensurePreviewLoop(stream, streamId)
    this.emitLocals()
    this.emit()
  }

  private mediaLocals(): number {
    let count = 0
    for (const pub of this.locals.values()) if (pub.streamType === 'screen' || pub.streamType === 'webcam') count += 1
    return count
  }

  private tuneAudio(sdp: string, streamId: string, bitrate: number): string {
    return streamId.endsWith(':voice') ? tuneOpusVoice(sdp, bitrate) : tuneOpus(sdp, bitrate)
  }

  private async hotSwap(previous: LocalPub, stream: MediaStream, settings: CaptureSettings): Promise<void> {
    const old = previous.stream
    previous.gen += 1
    previous.stream = stream
    previous.settings = settings
    this.prepareVideo(stream, settings)
    this.bindEnded(previous)
    const video = stream.getVideoTracks()[0] ?? null
    const audio = this.sendableAudio(stream)
    for (const link of this.links.values()) {
      if (link.role !== 'host' || link.streamId !== previous.streamId) continue
      try {
        if (link.videoSender && video) await link.videoSender.replaceTrack(video)
        if (link.audioSender) await link.audioSender.replaceTrack(audio)
        await this.tuneSender(link, previous)
      } catch (error) {
        console.warn('Falha na troca quente.', error)
        this.events.onError('Não foi possível trocar a tela em uma das conexões.')
      }
    }
    old.getTracks().forEach((track) => track.stop())
    if (previous.streamType === 'screen') this.ensurePreviewLoop(stream, previous.streamId)
    const meta = toStreamMeta(settings, previous.streamId, previous.streamType)
    this.socket.send({ type: 'stream-meta', streamId: previous.streamId, meta })
    this.emitLocals()
    this.emit()
  }

  private async handleMessage(message: ServerMessage): Promise<void> {
    if (this.disposed) return
    switch (message.type) {
      case 'joined':
        this.peers = new Map(message.peers.map((peer) => [peer.peerId, this.toRemote(peer)]))
        for (const pub of this.locals.values()) {
          this.socket.send({
            type: 'stream-meta',
            streamId: pub.streamId,
            meta: toStreamMeta(pub.settings, pub.streamId, pub.streamType)
          })
        }
        for (const streamId of this.watching) {
          if (this.ownerOf(streamId)?.streams.has(streamId)) this.socket.send({ type: 'watch', streamId })
        }
        this.subscribeVisibleWebcams()
        this.emit()
        return
      case 'peer-joined': {
        const returning = this.ghostMatches(message.peer.peerId, message.peer.displayName)
        if (!this.peers.has(message.peer.peerId) && !returning) {
          playUserJoinSound()
          if (message.peer.streams.some((meta) => meta.streamType === 'screen' || meta.streamType === 'webcam')) playStreamStartSound()
        }
        const peer = this.toRemote(message.peer)
        this.peers.set(message.peer.peerId, peer)
        for (const meta of message.peer.streams) {
          if (!this.claimGhost(peer, meta)) this.maybeRewatch(meta.streamId)
          this.considerWebcam(meta)
        }
        this.pushPreviewTo(message.peer.peerId)
        this.emit()
        return
      }
      case 'peer-left':
        this.handlePeerLeft(message.peerId)
        return
      case 'stream-meta':
        this.handleStreamMeta(message.peerId, message.streamId, message.meta)
        return
      case 'watch':
        this.enqueueHost(message.streamId, message.viewerId, () => this.handleWatch(message.streamId, message.viewerId))
        return
      case 'unwatch':
        this.enqueueHost(message.streamId, message.viewerId, async () => {
          this.closeLink(linkKey(message.streamId, message.viewerId))
          this.emitLocals()
          this.emit()
        })
        return
      case 'profile-updated':
        this.applyProfile(message.peerId, message.displayName, message.profile)
        return
      case 'watcher-joined':
        this.addWatcher(message.streamId, message.broadcasterId, message.watcher)
        return
      case 'watcher-left':
        this.removeWatcher(message.streamId, message.broadcasterId, message.peerId)
        return
      case 'signal':
        await this.handleSignal(message.from, message.payload)
        return
      case 'error':
        this.events.onError(message.message)
        return
      case 'chat':
        this.events.onChat(message.message)
        return
      case 'chat-history':
        this.events.onChatHistory(message.messages)
        return
      case 'pong':
        return
      case 'stream-preview':
        this.previews.set(message.streamId, message.image)
        for (const ghost of this.ghosts.values()) {
          if (ghost.peerId === message.peerId || ghost.streamId === message.streamId) ghost.poster = ghost.poster || message.image
        }
        this.emit()
        return
      case 'rooms':
      case 'rooms-updated':
        this.events.onRooms(message.rooms)
        return
      case 'music':
        this.events.onMusic(message.state)
        return
      default:
        return
    }
  }

  private toRemote(peer: { peerId: string; displayName: string; profile?: PublicProfile; streams: StreamMeta[]; watchers: Array<{ streamId: string; peerId: string; displayName: string }> }): RemotePeer {
    return {
      peerId: peer.peerId,
      displayName: peer.displayName,
      profile: publicProfileOf(sanitizeProfile(peer.profile, peer.displayName)),
      streams: new Map(peer.streams.map((meta) => [meta.streamId, meta])),
      watchers: groupWatchers(peer.watchers)
    }
  }

  private subscribeVisibleWebcams(): void {
    for (const peer of this.peers.values()) {
      for (const meta of peer.streams.values()) this.considerWebcam(meta)
    }
  }

  private considerWebcam(meta: StreamMeta): void {
    if (meta.streamType === 'voice' || meta.streamType === 'music') {
      if (!this.watching.has(meta.streamId)) this.watch(meta.streamId)
      return
    }
    if (meta.streamType !== 'webcam' || this.hiddenWebcams.has(meta.streamId) || this.watching.has(meta.streamId)) return
    this.watch(meta.streamId)
  }

  private applyProfile(peerId: string, displayName: string, profile: PublicProfile): void {
    if (peerId === this.peerId) return
    const peer = this.peers.get(peerId)
    if (!peer) return
    peer.displayName = displayName.trim().slice(0, 32) || peer.displayName
    renameRemoteVoice(peerId, peer.displayName)
    peer.profile = publicProfileOf(sanitizeProfile(profile, peer.displayName))
    this.emit()
  }

  private presentWatcher(watcher: WatcherInfo): WatcherInfo {
    const peer = this.peers.get(watcher.peerId)
    return {
      ...watcher,
      avatarDataUrl: peer?.profile.avatarDataUrl ?? watcher.avatarDataUrl ?? '',
      accentColor: peer?.profile.accentColor ?? watcher.accentColor ?? '#5865F2'
    }
  }

  private handlePeerLeft(peerId: string): void {
    const peer = this.peers.get(peerId)
    let quiet = false
    if (peer) {
      for (const [streamId, meta] of peer.streams) {
        if (meta.streamType === 'screen' && this.watching.has(streamId)) {
          this.holdGhost(peer, meta)
          quiet = true
        }
        if (this.watching.has(streamId)) this.watchMemory.set(streamId, Date.now() + 10_000)
        this.watching.delete(streamId)
        this.rewatchTried.delete(streamId)
        this.pendingRewatch.delete(streamId)
        this.remoteStreams.delete(streamId)
      }
      if (!quiet) playUserLeaveSound()
    }
    this.peers.delete(peerId)
    for (const key of [...this.links.keys()]) {
      const link = this.links.get(key)
      if (link && (link.broadcasterId === peerId || link.viewerId === peerId)) this.closeLink(key)
    }
    this.emit()
  }

  private handleStreamMeta(peerId: string, streamId: string, meta: StreamMeta | null): void {
    const peer = this.peers.get(peerId)
    if (!peer) return
    if (!meta) {
      const previous = peer.streams.get(streamId)
      const grace = previous?.streamType === 'screen' && this.watching.has(streamId)
      if (grace && previous) this.holdGhost(peer, previous)
      else if (previous && previous.streamType !== 'voice' && previous.streamType !== 'music') playStreamStopSound()
      peer.streams.delete(streamId)
      peer.watchers.delete(streamId)
      if (grace) this.watchMemory.set(streamId, Date.now() + 10_000)
      else this.watchMemory.delete(streamId)
      this.watching.delete(streamId)
      this.rewatchTried.delete(streamId)
      this.pendingRewatch.delete(streamId)
      this.remoteStreams.delete(streamId)
      this.closeLink(linkKey(streamId, this.peerId))
    } else {
      const had = peer.streams.has(streamId)
      peer.streams.set(streamId, meta)
      const claimed = this.claimGhost(peer, meta)
      if (!had && meta.streamType !== 'voice' && meta.streamType !== 'music' && !claimed) playStreamStartSound()
      this.considerWebcam(meta)
      if (!claimed) this.maybeRewatch(streamId)
    }
    this.emit()
  }

  private addWatcher(streamId: string, broadcasterId: string, watcher: WatcherInfo): void {
    if (broadcasterId === this.peerId) {
      const list = this.localWatchers.get(streamId) ?? []
      if (!list.some((item) => item.peerId === watcher.peerId)) {
        this.localWatchers.set(streamId, [...list, watcher])
        if (!streamId.endsWith(':voice') && !streamId.endsWith(':music')) playViewerJoinedMyStreamSound()
      }
      this.emitLocals()
      return
    }
    const peer = this.peers.get(broadcasterId)
    if (!peer) return
    const list = peer.watchers.get(streamId) ?? []
    if (!list.some((item) => item.peerId === watcher.peerId)) peer.watchers.set(streamId, [...list, watcher])
    this.emit()
  }

  private removeWatcher(streamId: string, broadcasterId: string, peerId: string): void {
    if (broadcasterId === this.peerId) {
      const list = this.localWatchers.get(streamId) ?? []
      this.localWatchers.set(
        streamId,
        list.filter((item) => item.peerId !== peerId)
      )
      this.emitLocals()
      return
    }
    const peer = this.peers.get(broadcasterId)
    if (!peer) return
    const list = peer.watchers.get(streamId) ?? []
    peer.watchers.set(
      streamId,
      list.filter((item) => item.peerId !== peerId)
    )
    this.emit()
  }

  private maybeRewatch(streamId: string): void {
    const expiry = this.watchMemory.get(streamId)
    if (!expiry) return
    this.watchMemory.delete(streamId)
    if (Date.now() > expiry) return
    this.watch(streamId)
  }

  private enqueueHost(streamId: string, viewerId: string, job: () => Promise<void>): void {
    const key = linkKey(streamId, viewerId)
    const previous = this.hostJobs.get(key) ?? Promise.resolve()
    const next = previous.then(job, job)
    this.hostJobs.set(key, next)
    void next.finally(() => {
      if (this.hostJobs.get(key) === next) this.hostJobs.delete(key)
    })
  }

  private async handleWatch(streamId: string, viewerId: string): Promise<void> {
    const pub = this.locals.get(streamId)
    if (this.disposed || !pub) return
    if (viewerId === this.peerId) return
    const video = pub.stream.getVideoTracks()[0]
    if (pub.streamType === 'voice' || pub.streamType === 'music') {
      await this.handleVoiceWatch(pub, viewerId)
      return
    }
    if (!video) return
    const key = linkKey(streamId, viewerId)
    this.closeLink(key)
    let link: PeerLink | null = null
    try {
      const audio = this.sendableAudio(pub.stream)
      link = this.createLink({
        key,
        role: 'host',
        streamId,
        broadcasterId: this.peerId,
        viewerId,
        remotePeerId: viewerId
      })
      const videoTransceiver = link.pc.addTransceiver(video, { direction: 'sendonly', streams: [pub.stream] })
      const audioTransceiver = link.pc.addTransceiver(audio, { direction: 'sendonly', streams: [pub.stream] })
      link.videoSender = videoTransceiver.sender
      link.audioSender = audioTransceiver.sender
      preferVideoCodecs(videoTransceiver)
      preferOpus(audioTransceiver)
      video.contentHint = pub.settings.contentHint
      const offer = await link.pc.createOffer()
      offer.sdp = tuneOpus(offer.sdp ?? '', pub.settings.audioBitrate)
      await link.pc.setLocalDescription(offer)
      if (this.links.get(key) !== link) return
      await this.tuneSender(link, pub)
      const description = link.pc.localDescription
      if (!description || this.links.get(key) !== link) return
      this.sendSignal(viewerId, {
        kind: 'offer',
        streamId,
        broadcasterId: this.peerId,
        viewerId,
        description: { type: description.type, sdp: description.sdp }
      })
      this.emitLocals()
    } catch (error) {
      if (link && this.links.get(key) !== link) return
      console.warn('Falha ao oferecer mídia.', error)
      if (link) this.closeLink(key)
      this.events.onError('Não foi possível abrir a transmissão para um espectador.')
      this.emitLocals()
    }
  }

  private async handleVoiceWatch(pub: LocalPub, viewerId: string): Promise<void> {
    const audio = pub.stream.getAudioTracks().find((track) => track.readyState === 'live')
    if (!audio) return
    const key = linkKey(pub.streamId, viewerId)
    this.closeLink(key)
    let link: PeerLink | null = null
    try {
      link = this.createLink({
        key,
        role: 'host',
        streamId: pub.streamId,
        broadcasterId: this.peerId,
        viewerId,
        remotePeerId: viewerId
      })
      const transceiver = link.pc.addTransceiver(audio, { direction: 'sendonly', streams: [pub.stream] })
      link.audioSender = transceiver.sender
      preferOpus(transceiver)
      const offer = await link.pc.createOffer()
      offer.sdp =
        pub.streamType === 'music' ? tuneOpus(offer.sdp ?? '', pub.settings.audioBitrate) : tuneOpusVoice(offer.sdp ?? '', pub.settings.audioBitrate)
      await link.pc.setLocalDescription(offer)
      const description = link.pc.localDescription
      if (!description || this.links.get(key) !== link) return
      this.sendSignal(viewerId, {
        kind: 'offer',
        streamId: pub.streamId,
        broadcasterId: this.peerId,
        viewerId,
        description: { type: description.type, sdp: description.sdp }
      })
    } catch (error) {
      if (link && this.links.get(key) !== link) return
      console.warn('Falha ao oferecer voz.', error)
      if (link) this.closeLink(key)
    }
  }

  private async handleSignal(from: string, payload: SignalPayload): Promise<void> {
    if (payload.broadcasterId !== this.peerId && payload.viewerId !== this.peerId) return
    if (payload.kind === 'offer') {
      await this.acceptOffer(from, payload)
      return
    }
    if (payload.kind === 'answer') {
      await this.acceptAnswer(payload)
      return
    }
    await this.addIce(payload)
  }

  private async answerExisting(link: PeerLink, from: string, payload: SignalPayload): Promise<void> {
    if (!payload.description) return
    await link.pc.setRemoteDescription(payload.description)
    await this.flushCandidates(link)
    const answer = await link.pc.createAnswer()
    const audioBitrate = this.metaOf(payload.streamId)?.audioBitrate ?? 256_000
    answer.sdp = this.tuneAudio(answer.sdp ?? '', payload.streamId, audioBitrate)
    await link.pc.setLocalDescription(answer)
    const description = link.pc.localDescription
    if (!description || this.links.get(link.key) !== link) return
    this.sendSignal(from, {
      kind: 'answer',
      streamId: payload.streamId,
      broadcasterId: payload.broadcasterId,
      viewerId: payload.viewerId,
      description: { type: description.type, sdp: description.sdp }
    })
    this.emit()
  }

  private streamRecovering(streamId: string): boolean {
    if (this.pendingRewatch.has(streamId)) return true
    for (const link of this.links.values()) {
      if (link.streamId === streamId && link.recovering) return true
    }
    return false
  }

  private noteIce(link: PeerLink): void {
    if (this.links.get(link.key) !== link) return
    const ice = link.pc.iceConnectionState
    const connection = link.pc.connectionState
    if (ice === 'connected' || ice === 'completed' || connection === 'connected') {
      this.clearRecovery(link)
      return
    }
    if (ice === 'disconnected' || ice === 'failed' || connection === 'failed') this.scheduleIceRestart(link)
  }

  private clearRecovery(link: PeerLink): void {
    if (link.recoveryTimer) {
      window.clearTimeout(link.recoveryTimer)
      link.recoveryTimer = 0
    }
    const was = link.recovering || link.attempts > 0 || this.pendingRewatch.has(link.streamId)
    link.recovering = false
    link.attempts = 0
    this.pendingRewatch.delete(link.streamId)
    this.rewatchTried.delete(link.streamId)
    if (!was) return
    this.emit()
    this.emitLocals()
  }

  private scheduleIceRestart(link: PeerLink): void {
    if (link.recoveryTimer || link.pc.connectionState === 'closed') return
    link.recovering = true
    this.emit()
    this.emitLocals()
    link.recoveryTimer = window.setTimeout(() => {
      link.recoveryTimer = 0
      if (this.links.get(link.key) !== link || this.disposed) return
      const ice = link.pc.iceConnectionState
      const connection = link.pc.connectionState
      if (ice === 'connected' || ice === 'completed' || connection === 'connected') {
        this.clearRecovery(link)
        return
      }
      if (ice === 'checking' || connection === 'connecting') {
        this.scheduleIceRestart(link)
        return
      }
      void this.restartLink(link)
    }, 1500)
  }

  private async restartLink(link: PeerLink): Promise<void> {
    if (this.links.get(link.key) !== link || this.disposed) return
    link.attempts += 1
    if (link.attempts > 3) {
      this.giveUp(link)
      return
    }
    if (link.role === 'host') {
      try {
        const pub = this.locals.get(link.streamId)
        if (!pub) return
        link.pc.restartIce()
        const offer = await link.pc.createOffer({ iceRestart: true })
        offer.sdp = this.tuneAudio(offer.sdp ?? '', link.streamId, pub.settings.audioBitrate)
        await link.pc.setLocalDescription(offer)
        const description = link.pc.localDescription
        if (!description || this.links.get(link.key) !== link) return
        this.sendSignal(link.viewerId, {
          kind: 'offer',
          streamId: link.streamId,
          broadcasterId: link.broadcasterId,
          viewerId: link.viewerId,
          description: { type: description.type, sdp: description.sdp }
        })
      } catch (error) {
        console.warn('ICE restart falhou.', error)
      }
      if (this.links.get(link.key) === link) this.scheduleIceRestart(link)
      return
    }
    try {
      link.pc.restartIce()
    } catch (error) {
      console.warn('ICE restart local falhou.', error)
    }
    if (this.links.get(link.key) === link) this.scheduleIceRestart(link)
  }

  private giveUp(link: PeerLink): void {
    link.recovering = false
    if (link.role === 'viewer' && !this.rewatchTried.has(link.streamId)) {
      this.rewatchTried.add(link.streamId)
      this.pendingRewatch.add(link.streamId)
      this.closeLink(link.key)
      this.watch(link.streamId)
      return
    }
    if (link.role === 'viewer') {
      this.pendingRewatch.delete(link.streamId)
      this.watching.delete(link.streamId)
      this.remoteStreams.delete(link.streamId)
      if (!link.streamId.endsWith(':voice') && !link.streamId.endsWith(':music')) this.events.onError('A conexão de mídia falhou. Tente assistir de novo.')
    }
    this.closeLink(link.key)
    this.emit()
    this.emitLocals()
  }

  private async acceptOffer(from: string, payload: SignalPayload): Promise<void> {
    if (payload.viewerId !== this.peerId || !payload.description) return
    if (!this.watching.has(payload.streamId)) return
    const key = linkKey(payload.streamId, payload.viewerId)
    const existing = this.links.get(key)
    if (existing && existing.pc.signalingState === 'stable' && existing.pc.connectionState !== 'closed') {
      try {
        await this.answerExisting(existing, from, payload)
        return
      } catch (error) {
        console.warn('Renegociação recusada, abrindo uma conexão nova.', error)
      }
    }
    this.closeLink(key)
    const link = this.createLink({
      key,
      role: 'viewer',
      streamId: payload.streamId,
      broadcasterId: payload.broadcasterId,
      viewerId: payload.viewerId,
      remotePeerId: from
    })
    try {
      await link.pc.setRemoteDescription(payload.description)
      await this.flushCandidates(link)
      const answer = await link.pc.createAnswer()
      const audioBitrate = this.metaOf(payload.streamId)?.audioBitrate ?? 256_000
      answer.sdp = this.tuneAudio(answer.sdp ?? '', payload.streamId, audioBitrate)
      await link.pc.setLocalDescription(answer)
      const description = link.pc.localDescription
      if (!description) return
      this.sendSignal(from, {
        kind: 'answer',
        streamId: payload.streamId,
        broadcasterId: payload.broadcasterId,
        viewerId: payload.viewerId,
        description: { type: description.type, sdp: description.sdp }
      })
      this.emit()
    } catch (error) {
      console.warn('Falha ao responder oferta.', error)
      this.closeLink(key)
      this.watching.delete(payload.streamId)
      this.events.onError('Não foi possível conectar à transmissão.')
      this.emit()
    }
  }

  private async acceptAnswer(payload: SignalPayload): Promise<void> {
    if (!this.locals.has(payload.streamId) || !payload.description) return
    const link = this.links.get(linkKey(payload.streamId, payload.viewerId))
    if (!link) return
    try {
      await link.pc.setRemoteDescription(payload.description)
      await this.flushCandidates(link)
      const pub = this.locals.get(payload.streamId)
      if (pub) await this.tuneSender(link, pub)
    } catch (error) {
      console.warn('Falha ao aplicar answer.', error)
      this.events.onError('A resposta WebRTC foi recusada.')
    }
  }

  private async addIce(payload: SignalPayload): Promise<void> {
    if (!payload.candidate) return
    const key = linkKey(payload.streamId, payload.viewerId)
    const link = this.links.get(key)
    if (!link) {
      const queued = this.earlyIce.get(key) ?? []
      queued.push(payload.candidate)
      this.earlyIce.set(key, queued)
      return
    }
    if (!link.pc.remoteDescription) {
      link.pendingCandidates.push(payload.candidate)
      return
    }
    try {
      await link.pc.addIceCandidate(payload.candidate)
    } catch (error) {
      console.warn('Candidato ICE ignorado.', error)
    }
  }

  private createLink(options: {
    key: string
    role: 'host' | 'viewer'
    streamId: string
    broadcasterId: string
    viewerId: string
    remotePeerId: string
  }): PeerLink {
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    })
    const link: PeerLink = {
      ...options,
      pc,
      videoSender: null,
      audioSender: null,
      pendingCandidates: this.earlyIce.get(options.key) ?? [],
      recoveryTimer: 0,
      attempts: 0,
      recovering: false
    }
    this.earlyIce.delete(options.key)
    this.links.set(options.key, link)

    pc.onicecandidate = (event) => {
      if (!event.candidate || this.disposed) return
      this.sendSignal(options.remotePeerId, {
        kind: 'ice',
        streamId: options.streamId,
        broadcasterId: options.broadcasterId,
        viewerId: options.viewerId,
        candidate: event.candidate.toJSON()
      })
    }

    pc.ontrack = (event) => {
      if (link.role !== 'viewer') return
      let media = event.streams[0] ?? this.remoteStreams.get(options.streamId) ?? null
      if (!media) media = new MediaStream()
      if (!event.streams[0] && !media.getTracks().includes(event.track)) media.addTrack(event.track)
      if (options.streamId.endsWith(':voice')) {
        attachRemoteVoice(options.broadcasterId, this.peers.get(options.broadcasterId)?.displayName ?? '', media)
        return
      }
      if (options.streamId.endsWith(':music')) {
        attachRemoteMusic(media)
        return
      }
      this.remoteStreams.set(options.streamId, media)
      this.emit()
    }

    pc.onconnectionstatechange = () => {
      if (this.links.get(options.key) !== link) return
      if (pc.connectionState === 'connected' && link.role === 'host') {
        const pub = this.locals.get(options.streamId)
        if (pub) void this.tuneSender(link, pub)
      }
      this.noteIce(link)
      this.emit()
      this.emitLocals()
    }

    pc.oniceconnectionstatechange = () => {
      if (this.links.get(options.key) !== link) return
      this.noteIce(link)
    }

    return link
  }

  private async flushCandidates(link: PeerLink): Promise<void> {
    const queued = link.pendingCandidates.splice(0)
    for (const candidate of queued) {
      try {
        await link.pc.addIceCandidate(candidate)
      } catch (error) {
        console.warn('Candidato ICE em fila ignorado.', error)
      }
    }
  }

  private async tuneSender(link: PeerLink, pub: LocalPub): Promise<void> {
    if (!link.videoSender) return
    try {
      await applyVideoEncoding(link.videoSender, pub.settings.maxBitrate, pub.settings.fps, pub.settings.contentHint)
    } catch (error) {
      console.warn('setParameters recusado.', error)
    }
  }

  private sendSignal(to: string, payload: SignalPayload): void {
    this.socket.send({ type: 'signal', to, payload })
  }

  private prepareVideo(stream: MediaStream, settings: CaptureSettings): void {
    const video = stream.getVideoTracks()[0]
    if (video) video.contentHint = settings.contentHint
  }

  private bindEnded(pub: LocalPub): void {
    const video = pub.stream.getVideoTracks()[0]
    if (!video) return
    const gen = pub.gen
    video.addEventListener(
      'ended',
      () => {
        if (this.disposed || this.locals.get(pub.streamId)?.gen !== gen) return
        this.stopStream(pub.streamType)
      },
      { once: true }
    )
  }

  private sendableAudio(stream: MediaStream): MediaStreamTrack {
    const live = stream.getAudioTracks().find((track) => track.readyState === 'live')
    if (live) return live
    return this.ensureSilentTrack()
  }

  private ensureSilentTrack(): MediaStreamTrack {
    if (this.silent && this.silent.track.readyState === 'live') return this.silent.track
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const destination = context.createMediaStreamDestination()
    gain.gain.value = 0
    oscillator.frequency.value = 0
    oscillator.connect(gain)
    gain.connect(destination)
    oscillator.start()
    void context.resume()
    const track = destination.stream.getAudioTracks()[0]
    if (!track) {
      void context.close()
      throw new Error('Não foi possível preparar o áudio da transmissão.')
    }
    this.silent = { context, track }
    return track
  }

  private releaseSilent(): void {
    this.silent?.track.stop()
    void this.silent?.context.close()
    this.silent = null
  }

  private setCaptureActive(active: boolean): void {
    if (this.captureActive === active) return
    this.captureActive = active
    if (window.electronAPI) void window.electronAPI.setCaptureActive(active)
  }

  private handleSocketDown(): void {
    this.closeAllLinks()
    this.remoteStreams.clear()
    this.earlyIce.clear()
    this.emit()
    this.emitLocals()
  }

  private closeLink(key: string): void {
    const link = this.links.get(key)
    if (!link) return
    this.links.delete(key)
    if (link.role === 'viewer' && link.streamId.endsWith(':voice')) detachRemoteVoice(link.broadcasterId)
    if (link.role === 'viewer' && link.streamId.endsWith(':music')) detachRemoteMusic()
    link.pc.onconnectionstatechange = null
    link.pc.oniceconnectionstatechange = null
    link.pc.ontrack = null
    link.pc.onicecandidate = null
    if (link.recoveryTimer) window.clearTimeout(link.recoveryTimer)
    link.recoveryTimer = 0
    link.pc.close()
  }

  private closeAllLinks(): void {
    for (const key of [...this.links.keys()]) this.closeLink(key)
  }

  private ownerOf(streamId: string): RemotePeer | undefined {
    for (const peer of this.peers.values()) {
      if (peer.streams.has(streamId)) return peer
    }
    return undefined
  }

  private metaOf(streamId: string): StreamMeta | undefined {
    return this.ownerOf(streamId)?.streams.get(streamId)
  }

  private hostPc(streamId: string): RTCPeerConnection | null {
    const hosts = [...this.links.values()].filter((link) => link.role === 'host' && link.streamId === streamId)
    const live = hosts.find((link) => link.pc.connectionState === 'connected')
    return (live ?? hosts[0])?.pc ?? null
  }

  private emitLocals(): void {
    if (this.disposed) return
    const publications: LocalPublication[] = [...this.locals.values()]
      .filter((pub) => pub.streamType === 'screen' || pub.streamType === 'webcam')
      .map((pub) => ({
      streamId: pub.streamId,
      meta: toStreamMeta(pub.settings, pub.streamId, pub.streamType),
      media: pub.stream,
      watchers: (this.localWatchers.get(pub.streamId) ?? []).map((watcher) => this.presentWatcher(watcher)),
      pc: this.hostPc(pub.streamId),
      reconnecting: this.streamRecovering(pub.streamId)
    }))
    this.events.onLocals(publications)
  }

  private emit(): void {
    if (this.disposed) return
    const peers: PeerView[] = [...this.peers.values()].map((peer) => ({
      peerId: peer.peerId,
      displayName: peer.displayName,
      profile: peer.profile,
      hasVoice: [...peer.streams.values()].some((meta) => meta.streamType === 'voice'),
      streams: [...peer.streams.values()]
        .filter((meta) => meta.streamType === 'screen' || meta.streamType === 'webcam')
        .map((meta) => ({
        streamId: meta.streamId,
        meta,
        media: this.remoteStreams.get(meta.streamId) ?? null,
        watching: this.watching.has(meta.streamId),
        pc: this.links.get(linkKey(meta.streamId, this.peerId))?.pc ?? null,
        watchers: (peer.watchers.get(meta.streamId) ?? []).map((watcher) => this.presentWatcher(watcher)),
        reconnecting: this.streamRecovering(meta.streamId),
        preview: this.previews.get(meta.streamId) ?? this.frames.get(meta.streamId) ?? '',
        hidden: meta.streamType === 'screen' && this.hiddenScreens.has(meta.streamId),
        slotKey: this.assignSlot(peer, meta.streamId)
      }))
    }))
    this.events.onSnapshot({ peers, ghosts: [...this.ghosts.values()] })
  }

  private normName(name: string): string {
    return name.trim().toLocaleLowerCase()
  }

  private slotFor(peerId: string, name: string): string {
    const key = this.normName(name)
    const same = [...this.peers.values()].filter((peer) => this.normName(peer.displayName) === key)
    return same.length <= 1 ? `screen:${key}` : `screen:${peerId}`
  }

  private assignSlot(peer: RemotePeer, streamId: string): string {
    const known = this.slotByStream.get(streamId)
    if (known) return known
    const slot = streamId.endsWith(':screen') ? this.slotFor(peer.peerId, peer.displayName) : streamId
    this.slotByStream.set(streamId, slot)
    return slot
  }

  private ghostMatches(peerId: string, name: string): ScreenGhost | undefined {
    const now = Date.now()
    const alive = [...this.ghosts.values()].filter((ghost) => ghost.expiresAt > now)
    const byId = alive.find((ghost) => ghost.peerId === peerId)
    if (byId) return byId
    const byName = alive.filter((ghost) => this.normName(ghost.name) === this.normName(name))
    if (byName.length !== 1) return undefined
    const others = [...this.peers.values()].filter(
      (peer) => peer.peerId !== peerId && this.normName(peer.displayName) === this.normName(name)
    )
    return others.length === 0 ? byName[0] : undefined
  }

  private holdGhost(peer: RemotePeer, meta: StreamMeta): void {
    const slotKey = this.assignSlot(peer, meta.streamId)
    const poster = this.frames.get(meta.streamId) || this.previews.get(meta.streamId) || ''
    this.ghosts.set(slotKey, {
      slotKey,
      peerId: peer.peerId,
      name: peer.displayName,
      avatarDataUrl: peer.profile.avatarDataUrl,
      accentColor: peer.profile.accentColor,
      customStatus: peer.profile.customStatus,
      sourceName: meta.sourceName,
      streamId: meta.streamId,
      poster,
      expiresAt: Date.now() + 10_000,
      meta
    })
    this.armGhosts()
  }

  private dropGhost(streamId: string): void {
    const slot = this.slotByStream.get(streamId)
    if (slot) this.ghosts.delete(slot)
    for (const [key, ghost] of this.ghosts) {
      if (ghost.streamId === streamId) this.ghosts.delete(key)
    }
  }

  private claimGhost(peer: RemotePeer, meta: StreamMeta): boolean {
    if (meta.streamType !== 'screen') return false
    const ghost = this.ghostMatches(peer.peerId, peer.displayName)
    if (!ghost) return false
    this.ghosts.delete(ghost.slotKey)
    this.slotByStream.set(meta.streamId, ghost.slotKey)
    if (ghost.poster) this.frames.set(meta.streamId, ghost.poster)
    this.watch(meta.streamId)
    return true
  }

  private armGhosts(): void {
    if (this.ghostTimer !== null) return
    this.ghostTimer = window.setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const [key, ghost] of this.ghosts) {
        if (ghost.expiresAt <= now) {
          this.ghosts.delete(key)
          changed = true
        }
      }
      if (this.ghosts.size === 0 && this.ghostTimer !== null) {
        window.clearInterval(this.ghostTimer)
        this.ghostTimer = null
      }
      if (changed) this.emit()
    }, 400)
  }

  private ensurePreviewLoop(stream: MediaStream, streamId: string): void {
    if (!this.previewVideo) {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      this.previewVideo = video
    }
    if (this.previewVideo.srcObject !== stream) {
      this.previewVideo.srcObject = stream
      void this.previewVideo.play().catch(() => undefined)
    }
    if (this.previewTimer !== null) return
    const tick = (): void => {
      void this.capturePreview(streamId)
    }
    window.setTimeout(tick, 500)
    this.previewTimer = window.setInterval(tick, PREVIEW_REFRESH_MS)
  }

  private stopPreviewLoop(): void {
    if (this.previewTimer !== null) window.clearInterval(this.previewTimer)
    this.previewTimer = null
    this.lastPreviewImage = ''
    this.lastPreviewStreamId = ''
    if (this.previewVideo) this.previewVideo.srcObject = null
  }

  private async capturePreview(streamId: string): Promise<void> {
    const video = this.previewVideo
    const pub = this.locals.get(streamId)
    if (!video || !pub || pub.streamType !== 'screen' || video.readyState < 2 || video.videoWidth < 2) return
    const width = 480
    const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, width, height)
    let quality = 0.55
    let image = canvas.toDataURL('image/webp', quality)
    while (image.length > 48_000 && quality > 0.2) {
      quality = Math.round((quality - 0.1) * 10) / 10
      image = canvas.toDataURL('image/webp', quality)
    }
    if (!image.startsWith('data:image/webp;base64,') || image.length > 48_000) return
    this.lastPreviewImage = image
    this.lastPreviewStreamId = streamId
    this.socket.send({ type: 'stream-preview', streamId, image })
  }

  private pushPreviewTo(peerId: string): void {
    if (!this.lastPreviewImage || !this.lastPreviewStreamId) return
    this.socket.send({
      type: 'stream-preview',
      streamId: this.lastPreviewStreamId,
      image: this.lastPreviewImage,
      to: peerId
    })
  }
}

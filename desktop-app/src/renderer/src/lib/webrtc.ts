import { buildIceServers } from '@renderer/lib/ice'
import { publicProfileOf, sanitizeProfile } from '@renderer/lib/profile'
import {
  playStreamStartSound,
  playStreamStopSound,
  playUserJoinSound,
  playUserLeaveSound,
  playViewerJoinedMyStreamSound
} from '@renderer/utils/soundEffects'
import { applyVideoEncoding, preferOpus, preferVideoCodecs, tuneOpus } from '@renderer/lib/sdp'
import { SignalingClient } from '@renderer/lib/signaling'
import {
  streamIdFor,
  toStreamMeta,
  type CaptureSettings,
  type ConnectionStatus,
  type LocalPublication,
  type PeerView,
  type ServerMessage,
  type SignalPayload,
  type StreamMeta,
  type StreamType,
  type TurnCredentials,
  type PublicProfile,
  type WatcherInfo
} from '@renderer/types'

export interface MeshSnapshot {
  peers: PeerView[]
}

export interface MeshEvents {
  onStatus: (status: ConnectionStatus) => void
  onSnapshot: (snapshot: MeshSnapshot) => void
  onLocals: (publications: LocalPublication[]) => void
  onError: (message: string) => void
}

interface SessionOptions {
  url: string
  roomId: string
  peerId: string
  displayName: string
  profile: PublicProfile
  turn: TurnCredentials | null
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
}

function linkKey(streamId: string, viewerId: string): string {
  return `${streamId}>${viewerId}`
}

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
  private readonly iceServers: RTCIceServer[]
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
  private watchMemory = new Map<string, number>()
  private hostJobs = new Map<string, Promise<void>>()
  private locals = new Map<string, LocalPub>()
  private localWatchers = new Map<string, WatcherInfo[]>()
  private silent: { context: AudioContext; track: MediaStreamTrack } | null = null
  private disposed = false
  private captureActive = false

  constructor(options: SessionOptions) {
    this.events = options.events
    this.peerId = options.peerId
    this.roomId = options.roomId
    this.displayName = options.displayName
    this.profile = options.profile
    this.iceServers = buildIceServers(options.turn)
    this.socket = new SignalingClient(options.url)
    this.socket.onStatus = (status) => {
      if (!this.disposed) this.events.onStatus(status)
    }
    this.socket.onOpen = () => {
      if (this.disposed) return
      this.socket.send({
        type: 'join',
        roomId: this.roomId,
        peerId: this.peerId,
        displayName: this.displayName,
        profile: this.profile
      })
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
    this.socket.start()
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
    playStreamStopSound()
    if (this.locals.size === 0) this.releaseSilent()
    this.socket.send({ type: 'stream-meta', streamId, meta: null })
    this.setCaptureActive(this.locals.size > 0)
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
    this.watchMemory.delete(streamId)
    this.watching.add(streamId)
    this.socket.send({ type: 'watch', streamId })
    this.emit()
  }

  unwatch(streamId: string): void {
    if (streamId.endsWith(':webcam')) this.hiddenWebcams.add(streamId)
    this.watching.delete(streamId)
    this.watchMemory.delete(streamId)
    this.socket.send({ type: 'unwatch', streamId })
    const owner = this.ownerOf(streamId)
    if (owner) this.closeLink(linkKey(streamId, this.peerId))
    this.remoteStreams.delete(streamId)
    this.emit()
  }

  dispose(): void {
    for (const streamType of ['screen', 'webcam'] as const) this.stopStream(streamType)
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
    this.setCaptureActive(true)
    this.emitLocals()
    this.emit()
    playStreamStartSound()
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
      case 'peer-joined':
        if (!this.peers.has(message.peer.peerId)) {
          playUserJoinSound()
          if (message.peer.streams.length > 0) playStreamStartSound()
        }
        this.peers.set(message.peer.peerId, this.toRemote(message.peer))
        for (const meta of message.peer.streams) {
          this.maybeRewatch(meta.streamId)
          this.considerWebcam(meta)
        }
        this.emit()
        return
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
      case 'pong':
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
    if (meta.streamType !== 'webcam' || this.hiddenWebcams.has(meta.streamId) || this.watching.has(meta.streamId)) return
    this.watch(meta.streamId)
  }

  private applyProfile(peerId: string, displayName: string, profile: PublicProfile): void {
    if (peerId === this.peerId) return
    const peer = this.peers.get(peerId)
    if (!peer) return
    peer.displayName = displayName.trim().slice(0, 32) || peer.displayName
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
    if (peer) {
      playUserLeaveSound()
      for (const streamId of peer.streams.keys()) {
        if (this.watching.has(streamId)) this.watchMemory.set(streamId, Date.now() + 8000)
        this.watching.delete(streamId)
        this.remoteStreams.delete(streamId)
      }
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
      const had = peer.streams.has(streamId)
      if (had) playStreamStopSound()
      peer.streams.delete(streamId)
      peer.watchers.delete(streamId)
      this.watchMemory.delete(streamId)
      this.watching.delete(streamId)
      this.remoteStreams.delete(streamId)
      this.closeLink(linkKey(streamId, this.peerId))
    } else {
      const had = peer.streams.has(streamId)
      peer.streams.set(streamId, meta)
      if (!had) playStreamStartSound()
      this.considerWebcam(meta)
      this.maybeRewatch(streamId)
    }
    this.emit()
  }

  private addWatcher(streamId: string, broadcasterId: string, watcher: WatcherInfo): void {
    if (broadcasterId === this.peerId) {
      const list = this.localWatchers.get(streamId) ?? []
      if (!list.some((item) => item.peerId === watcher.peerId)) {
        this.localWatchers.set(streamId, [...list, watcher])
        playViewerJoinedMyStreamSound()
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

  private async acceptOffer(from: string, payload: SignalPayload): Promise<void> {
    if (payload.viewerId !== this.peerId || !payload.description) return
    if (!this.watching.has(payload.streamId)) return
    const key = linkKey(payload.streamId, payload.viewerId)
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
      answer.sdp = tuneOpus(answer.sdp ?? '', audioBitrate)
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
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    })
    const link: PeerLink = {
      ...options,
      pc,
      videoSender: null,
      audioSender: null,
      pendingCandidates: this.earlyIce.get(options.key) ?? []
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
      this.remoteStreams.set(options.streamId, media)
      this.emit()
    }

    pc.onconnectionstatechange = () => {
      if (this.links.get(options.key) !== link) return
      if (pc.connectionState === 'connected' && link.role === 'host') {
        const pub = this.locals.get(options.streamId)
        if (pub) void this.tuneSender(link, pub)
      }
      if (pc.connectionState === 'failed') {
        if (link.role === 'viewer') {
          this.watching.delete(link.streamId)
          this.remoteStreams.delete(link.streamId)
          this.events.onError('A conexão de mídia falhou. Tente assistir de novo.')
        }
        this.closeLink(options.key)
      }
      this.emit()
      this.emitLocals()
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
    link.pc.onconnectionstatechange = null
    link.pc.ontrack = null
    link.pc.onicecandidate = null
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
    const publications: LocalPublication[] = [...this.locals.values()].map((pub) => ({
      streamId: pub.streamId,
      meta: toStreamMeta(pub.settings, pub.streamId, pub.streamType),
      media: pub.stream,
      watchers: (this.localWatchers.get(pub.streamId) ?? []).map((watcher) => this.presentWatcher(watcher)),
      pc: this.hostPc(pub.streamId)
    }))
    this.events.onLocals(publications)
  }

  private emit(): void {
    if (this.disposed) return
    const peers: PeerView[] = [...this.peers.values()].map((peer) => ({
      peerId: peer.peerId,
      displayName: peer.displayName,
      profile: peer.profile,
      streams: [...peer.streams.values()].map((meta) => ({
        streamId: meta.streamId,
        meta,
        media: this.remoteStreams.get(meta.streamId) ?? null,
        watching: this.watching.has(meta.streamId),
        pc: this.links.get(linkKey(meta.streamId, this.peerId))?.pc ?? null,
        watchers: (peer.watchers.get(meta.streamId) ?? []).map((watcher) => this.presentWatcher(watcher))
      }))
    }))
    this.events.onSnapshot({ peers })
  }
}

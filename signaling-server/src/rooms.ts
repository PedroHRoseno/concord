import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import {
  isSignalPayload,
  parseFeatures,
  validateChat,
  type ChatMessage,
  type Feature,
  isStreamId,
  isStreamMeta,
  parseMusicRequest,
  PREVIEW_IMAGE_MAX,
  sanitizeProfile,
  type MusicState,
  type MusicTrack,
  type PeerInfo,
  type PublicProfile,
  type ServerMessage,
  type SignalPayload,
  type RoomCard,
  type StreamMeta,
  type WatcherInfo
} from './types.js'

export interface Member {
  socket: WebSocket
  peerId: string
  displayName: string
  profile: PublicProfile
  roomId: string
  streams: Map<string, StreamMeta>
  watchers: Map<string, Set<string>>
  isAlive: boolean
  features: Set<Feature>
  chatTimes: number[]
  speaking: boolean
  muted: boolean
  musicTimes: number[]
}

const PINNED_ROOMS: Array<{ roomId: string; label: string }> = [
  { roomId: 'geral', label: 'Sala geral' },
  { roomId: 'jogatina', label: 'Jogatina' },
  { roomId: 'afk', label: 'AFK' }
]
const PINNED_IDS = new Set(PINNED_ROOMS.map((room) => room.roomId))
const DIRECTORY_LIMIT = 48_000

const HISTORY_LIMIT = 100
const HISTORY_IMAGE_BYTES = 600_000
const CHAT_WINDOW_MS = 3000
const CHAT_BURST = 5

const QUEUE_LIMIT = 40
const MUSIC_WINDOW_MS = 10_000
const MUSIC_BURST = 5

interface RoomMusic {
  current: MusicTrack | null
  queue: MusicTrack[]
  votes: Set<string>
}

const isVoiceId = (streamId: string): boolean => streamId.endsWith(':voice')

function streamGate(streamId: string): Feature | null {
  if (streamId.endsWith(':voice')) return 'voice'
  if (streamId.endsWith(':music')) return 'music'
  return null
}

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/
const PEER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class RoomHub {
  private rooms = new Map<string, Map<string, Member>>()
  private bySocket = new Map<WebSocket, Member>()
  private history = new Map<string, ChatMessage[]>()
  private unlisted = new Map<string, boolean>()
  private directoryWatchers = new Set<WebSocket>()
  private directoryTimer: ReturnType<typeof setTimeout> | null = null
  private music = new Map<string, RoomMusic>()

  roomCount(): number {
    return this.rooms.size
  }

  join(
    socket: WebSocket,
    roomId: string,
    peerId: string,
    displayName: string,
    profile: unknown,
    features?: unknown,
    unlisted?: boolean
  ): { ok: true } | { ok: false; error: string } {
    if (!ROOM_RE.test(roomId)) {
      return { ok: false, error: 'ID da sala inválido. Use letras, números, _ e - (até 64).' }
    }
    const name = displayName.trim()
    if (name.length < 1 || name.length > 32) {
      return { ok: false, error: 'O nome precisa ter entre 1 e 32 caracteres.' }
    }
    if (!PEER_RE.test(peerId)) {
      return { ok: false, error: 'Identificador do peer inválido.' }
    }
    if (this.bySocket.has(socket)) {
      return { ok: false, error: 'Esta conexão já está em uma sala.' }
    }

    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Map()
      this.rooms.set(roomId, room)
      this.unlisted.set(roomId, PINNED_IDS.has(roomId) ? false : unlisted === true)
    }
    const existing = room.get(peerId)
    if (existing) {
      if (existing.socket.readyState === WebSocket.OPEN) {
        return { ok: false, error: 'Este peer já está na sala.' }
      }
      this.bySocket.delete(existing.socket)
      room.delete(peerId)
    }

    const feats = parseFeatures(features)
    const peers = [...room.values()].map((other) => this.toInfo(room, other, feats))
    const member: Member = {
      socket,
      peerId,
      displayName: name,
      profile: sanitizeProfile(profile),
      roomId,
      streams: new Map(),
      watchers: new Map(),
      isAlive: true,
      features: feats,
      chatTimes: [],
      speaking: false,
      muted: false,
      musicTimes: []
    }
    room.set(peerId, member)
    this.bySocket.set(socket, member)
    this.send(socket, { type: 'joined', peerId, peers })
    this.broadcastWith(roomId, peerId, (other) => ({
      type: 'peer-joined',
      peer: this.toInfo(room, member, other.features)
    }))
    if (feats.has('chat')) {
      this.send(socket, { type: 'chat-history', messages: this.history.get(roomId) ?? [] })
    }
    if (feats.has('music')) this.send(socket, { type: 'music', state: this.publicMusic(roomId) })
    console.log(`[${roomId}] ${name} entrou (${room.size})`)
    this.touchDirectory()
    return { ok: true }
  }

  watchRooms(socket: WebSocket): void {
    this.directoryWatchers.add(socket)
    this.send(socket, { type: 'rooms', rooms: this.publicRooms() })
  }

  voiceState(socket: WebSocket, speaking: boolean, muted: boolean): void {
    const member = this.bySocket.get(socket)
    if (!member) return
    if (member.speaking === speaking && member.muted === muted) return
    member.speaking = speaking
    member.muted = muted
    this.touchDirectory()
  }

  leave(socket: WebSocket): void {
    this.directoryWatchers.delete(socket)
    const member = this.bySocket.get(socket)
    if (!member) return
    this.bySocket.delete(socket)
    const room = this.rooms.get(member.roomId)
    if (!room) return
    this.dropViewer(room, member.peerId)
    room.delete(member.peerId)
    this.broadcast(member.roomId, { type: 'peer-left', peerId: member.peerId })
    console.log(`[${member.roomId}] ${member.displayName} saiu (${room.size})`)
    this.noteMusicLeave(member)
    if (room.size === 0) {
      this.rooms.delete(member.roomId)
      this.history.delete(member.roomId)
      this.unlisted.delete(member.roomId)
      this.music.delete(member.roomId)
    }
    this.touchDirectory()
  }

  chat(socket: WebSocket, text: unknown, image: unknown): void {
    const member = this.require(socket)
    if (!member) return
    const now = Date.now()
    member.chatTimes = member.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS)
    if (member.chatTimes.length >= CHAT_BURST) {
      this.send(socket, { type: 'error', message: 'Você está enviando mensagens rápido demais.' })
      return
    }
    const result = validateChat(text, image)
    if (!result.ok) {
      this.send(socket, { type: 'error', message: result.error })
      return
    }
    member.chatTimes.push(now)
    const message: ChatMessage = {
      id: randomUUID(),
      peerId: member.peerId,
      displayName: member.displayName,
      text: result.text,
      ts: now
    }
    if (result.image) message.image = result.image
    const log = this.history.get(member.roomId) ?? []
    log.push(message)
    while (log.length > HISTORY_LIMIT) log.shift()
    let bytes = 0
    for (let i = log.length - 1; i >= 0; i--) {
      const img = log[i].image
      if (!img) continue
      bytes += img.length
      if (bytes > HISTORY_IMAGE_BYTES) log[i] = { ...log[i], image: undefined }
    }
    this.history.set(member.roomId, log)
    this.broadcastWith(member.roomId, undefined, (other) => (other.features.has('chat') ? { type: 'chat', message } : null))
  }

  setStream(socket: WebSocket, streamId: unknown, meta: unknown): void {
    const member = this.require(socket)
    if (!member) return
    if (!isStreamId(streamId)) {
      this.send(socket, { type: 'error', message: 'Metadados da transmissão inválidos.' })
      return
    }
    const room = this.rooms.get(member.roomId)
    if (!room) return
    if (meta === null) {
      this.clearStream(member, streamId)
      return
    }
    if (!isStreamMeta(meta) || meta.streamId !== streamId) {
      this.send(socket, { type: 'error', message: 'Metadados da transmissão inválidos.' })
      return
    }
    for (const [id, existing] of member.streams) {
      if (id !== streamId && existing.streamType === meta.streamType) this.clearStream(member, id)
    }
    member.streams.set(streamId, meta)
    if (!member.watchers.has(streamId)) member.watchers.set(streamId, new Set())
    this.broadcast(member.roomId, { type: 'stream-meta', peerId: member.peerId, streamId, meta }, undefined, streamGate(streamId))
    console.log(`[${member.roomId}] ${member.displayName} transmitindo ${meta.streamType}`)
    this.touchDirectory()
  }

  updateProfile(socket: WebSocket, displayName: unknown, profile: unknown): void {
    const member = this.require(socket)
    if (!member) return
    if (typeof displayName === 'string') {
      const name = displayName.trim()
      if (name.length >= 1 && name.length <= 32) member.displayName = name
    }
    member.profile = sanitizeProfile(profile)
    this.broadcast(member.roomId, {
      type: 'profile-updated',
      peerId: member.peerId,
      displayName: member.displayName,
      profile: member.profile
    })
    this.touchDirectory()
  }

  relayPreview(socket: WebSocket, streamId: unknown, image: unknown, to: unknown): void {
    const member = this.require(socket)
    if (!member) return
    if (!isStreamId(streamId) || !streamId.endsWith(':screen')) return
    if (typeof image !== 'string' || !image.startsWith('data:image/webp;base64,') || image.length > PREVIEW_IMAGE_MAX) return
    const message: ServerMessage = { type: 'stream-preview', peerId: member.peerId, streamId, image }
    if (typeof to === 'string' && to.length > 0 && to.length <= 80) {
      const target = this.rooms.get(member.roomId)?.get(to)
      if (target) this.send(target.socket, message)
      return
    }
    this.broadcast(member.roomId, message, member.peerId)
  }

  signal(socket: WebSocket, to: string, payload: unknown): void {
    const member = this.require(socket)
    if (!member) return
    if (typeof to !== 'string' || !isSignalPayload(payload)) {
      this.send(socket, { type: 'error', message: 'Pacote de sinalização inválido.' })
      return
    }
    const target = this.rooms.get(member.roomId)?.get(to)
    if (!target) {
      this.send(socket, { type: 'error', message: 'O peer de destino não está na sala.' })
      return
    }
    this.send(target.socket, { type: 'signal', from: member.peerId, payload: payload as SignalPayload })
  }

  watch(socket: WebSocket, streamId: unknown, kind: 'watch' | 'unwatch'): void {
    const member = this.require(socket)
    if (!member) return
    if (!isStreamId(streamId)) return
    const room = this.rooms.get(member.roomId)
    if (!room) return
    const owner = this.ownerOf(room, streamId)
    if (!owner || owner.peerId === member.peerId || !owner.streams.has(streamId)) {
      this.send(socket, { type: 'error', message: 'O transmissor não está na sala.' })
      return
    }
    const set = owner.watchers.get(streamId) ?? new Set<string>()
    owner.watchers.set(streamId, set)
    if (kind === 'watch') {
      set.add(member.peerId)
      this.broadcast(
        member.roomId,
        {
          type: 'watcher-joined',
          streamId,
          broadcasterId: owner.peerId,
          watcher: { peerId: member.peerId, displayName: member.displayName }
        },
        undefined,
        streamGate(streamId)
      )
      this.send(owner.socket, { type: 'watch', streamId, viewerId: member.peerId })
      return
    }
    set.delete(member.peerId)
    this.broadcast(
      member.roomId,
      {
        type: 'watcher-left',
        streamId,
        broadcasterId: owner.peerId,
        peerId: member.peerId
      },
      undefined,
      streamGate(streamId)
    )
    this.send(owner.socket, { type: 'unwatch', streamId, viewerId: member.peerId })
  }

  markAlive(socket: WebSocket): void {
    const member = this.bySocket.get(socket)
    if (member) member.isAlive = true
  }

  members(): Member[] {
    return [...this.bySocket.values()]
  }

  private clearStream(member: Member, streamId: string): void {
    if (!member.streams.has(streamId)) return
    member.streams.delete(streamId)
    member.watchers.delete(streamId)
    this.broadcast(
      member.roomId,
      {
        type: 'stream-meta',
        peerId: member.peerId,
        streamId,
        meta: null
      },
      undefined,
      streamGate(streamId)
    )
    console.log(`[${member.roomId}] ${member.displayName} parou ${streamId}`)
    this.touchDirectory()
  }

  private dropViewer(room: Map<string, Member>, peerId: string): void {
    for (const owner of room.values()) {
      for (const [streamId, set] of owner.watchers) {
        if (!set.delete(peerId)) continue
        this.broadcast(
          owner.roomId,
          {
            type: 'watcher-left',
            streamId,
            broadcasterId: owner.peerId,
            peerId
          },
          undefined,
          streamGate(streamId)
        )
      }
    }
  }

  private ownerOf(room: Map<string, Member>, streamId: string): Member | undefined {
    for (const member of room.values()) {
      if (member.streams.has(streamId)) return member
    }
    return undefined
  }

  addMusic(socket: WebSocket, payload: Record<string, unknown>): void {
    const member = this.require(socket)
    if (!member) return
    if (!member.features.has('music')) return
    const now = Date.now()
    member.musicTimes = member.musicTimes.filter((at) => now - at < MUSIC_WINDOW_MS)
    if (member.musicTimes.length >= MUSIC_BURST) {
      this.send(socket, { type: 'error', message: 'Você está adicionando músicas rápido demais.' })
      return
    }
    const parsed = parseMusicRequest(payload)
    if (!parsed.ok) {
      this.send(socket, { type: 'error', message: parsed.error })
      return
    }
    const state = this.musicOf(member.roomId)
    if (state.queue.length >= QUEUE_LIMIT || (state.current && state.queue.length >= QUEUE_LIMIT)) {
      this.send(socket, { type: 'error', message: 'A fila de música está cheia.' })
      return
    }
    const track: MusicTrack = {
      id: randomUUID(),
      sourceUrl: parsed.sourceUrl,
      provider: parsed.provider,
      videoId: parsed.videoId,
      title: parsed.title,
      artist: parsed.artist,
      artwork: parsed.artwork,
      addedBy: member.peerId,
      addedByName: member.displayName
    }
    member.musicTimes.push(now)
    if (!state.current) state.current = track
    else state.queue.push(track)
    this.pushMusic(member.roomId)
  }

  voteSkip(socket: WebSocket): void {
    const member = this.require(socket)
    if (!member || !member.features.has('music')) return
    const state = this.music.get(member.roomId)
    if (!state?.current) return
    if (state.current.addedBy === member.peerId) {
      this.send(socket, { type: 'error', message: 'Quem adicionou a faixa pula direto.' })
      return
    }
    state.votes.add(member.peerId)
    if (state.votes.size >= this.needed(member.roomId)) this.advance(member.roomId)
    else this.pushMusic(member.roomId)
  }

  forceSkip(socket: WebSocket): void {
    const member = this.require(socket)
    if (!member || !member.features.has('music')) return
    const state = this.music.get(member.roomId)
    if (!state?.current) return
    if (state.current.addedBy !== member.peerId) {
      this.send(socket, { type: 'error', message: 'Só quem adicionou a faixa pode pular direto.' })
      return
    }
    this.advance(member.roomId)
  }

  musicEnded(socket: WebSocket, trackId: unknown): void {
    const member = this.require(socket)
    if (!member || typeof trackId !== 'string') return
    const state = this.music.get(member.roomId)
    if (!state?.current || state.current.id !== trackId || state.current.addedBy !== member.peerId) return
    this.advance(member.roomId)
  }

  private musicOf(roomId: string): RoomMusic {
    const existing = this.music.get(roomId)
    if (existing) return existing
    const created: RoomMusic = { current: null, queue: [], votes: new Set() }
    this.music.set(roomId, created)
    return created
  }

  private needed(roomId: string): number {
    return Math.max(1, Math.ceil((this.rooms.get(roomId)?.size ?? 1) * 0.5))
  }

  private publicMusic(roomId: string): MusicState {
    const state = this.musicOf(roomId)
    return {
      current: state.current,
      queue: state.queue,
      votes: [...state.votes],
      needed: this.needed(roomId)
    }
  }

  private pushMusic(roomId: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    const message: ServerMessage = { type: 'music', state: this.publicMusic(roomId) }
    for (const member of room.values()) {
      if (member.features.has('music')) this.send(member.socket, message)
    }
  }

  private advance(roomId: string): void {
    const state = this.musicOf(roomId)
    const room = this.rooms.get(roomId)
    state.votes.clear()
    let next = state.queue.shift() ?? null
    while (next && room && !room.has(next.addedBy)) next = state.queue.shift() ?? null
    state.current = next
    this.pushMusic(roomId)
  }

  private noteMusicLeave(member: Member): void {
    const state = this.music.get(member.roomId)
    if (!state) return
    state.votes.delete(member.peerId)
    state.queue = state.queue.filter((track) => track.addedBy !== member.peerId)
    if (state.current?.addedBy === member.peerId) {
      this.advance(member.roomId)
      return
    }
    if (state.current && state.votes.size >= this.needed(member.roomId)) this.advance(member.roomId)
    else this.pushMusic(member.roomId)
  }

  private toInfo(room: Map<string, Member>, member: Member, viewerFeatures: Set<Feature>): PeerInfo {
    const watchers: PeerInfo['watchers'] = []
    const viewerHasVoice = viewerFeatures.has('voice')
    const viewerHasMusic = viewerFeatures.has('music')
    for (const [streamId, ids] of member.watchers) {
      if (!viewerHasVoice && isVoiceId(streamId)) continue
      if (!viewerHasMusic && streamId.endsWith(':music')) continue
      for (const peerId of ids) {
        const watcher = room.get(peerId)
        if (!watcher) continue
        const info: WatcherInfo = { peerId, displayName: watcher.displayName }
        watchers.push({ streamId, ...info })
      }
    }
    return {
      peerId: member.peerId,
      displayName: member.displayName,
      profile: member.profile,
      streams: [...member.streams.values()].filter((stream) => {
        if (stream.streamType === 'voice') return viewerHasVoice
        if (stream.streamType === 'music') return viewerHasMusic
        return true
      }),
      watchers
    }
  }

  private touchDirectory(): void {
    if (this.directoryTimer) return
    this.directoryTimer = setTimeout(() => {
      this.directoryTimer = null
      const message: ServerMessage = { type: 'rooms-updated', rooms: this.publicRooms() }
      for (const socket of this.directoryWatchers) this.send(socket, message)
    }, 300)
  }

  private publicRooms(): RoomCard[] {
    const cards = new Map<string, RoomCard>()
    for (const pin of PINNED_ROOMS) {
      cards.set(pin.roomId, { roomId: pin.roomId, label: pin.label, members: [], activity: { screens: [], cameras: 0 } })
    }
    for (const [roomId, room] of this.rooms) {
      if (this.unlisted.get(roomId) && !PINNED_IDS.has(roomId)) continue
      const label = PINNED_ROOMS.find((pin) => pin.roomId === roomId)?.label ?? roomId
      const members = [...room.values()].map((member) => ({
        peerId: member.peerId,
        name: member.displayName,
        avatar: member.profile.avatarDataUrl,
        accentColor: member.profile.accentColor,
        statusText: member.profile.customStatus,
        isSpeaking: member.speaking,
        isMuted: member.muted
      }))
      const screens: Array<{ sourceName: string }> = []
      let cameras = 0
      for (const member of room.values()) {
        for (const stream of member.streams.values()) {
          if (stream.streamType === 'screen') screens.push({ sourceName: stream.sourceName })
          if (stream.streamType === 'webcam') cameras += 1
        }
      }
      cards.set(roomId, { roomId, label, members, activity: { screens, cameras } })
    }
    const listed = [...cards.values()]
    let payload = JSON.stringify(listed)
    if (payload.length <= DIRECTORY_LIMIT) return listed
    for (let roomIndex = listed.length - 1; roomIndex >= 0 && payload.length > DIRECTORY_LIMIT; roomIndex -= 1) {
      const members = listed[roomIndex].members
      for (let memberIndex = members.length - 1; memberIndex >= 0 && payload.length > DIRECTORY_LIMIT; memberIndex -= 1) {
        if (!members[memberIndex].avatar) continue
        members[memberIndex] = { ...members[memberIndex], avatar: '' }
        payload = JSON.stringify(listed)
      }
    }
    return listed
  }

  private require(socket: WebSocket): Member | null {
    const member = this.bySocket.get(socket)
    if (!member) {
      this.send(socket, { type: 'error', message: 'Entre em uma sala antes de enviar mensagens.' })
      return null
    }
    return member
  }

  private broadcast(roomId: string, message: ServerMessage, exceptPeerId?: string, gate: Feature | null = null): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    for (const member of room.values()) {
      if (member.peerId === exceptPeerId) continue
      if (gate && !member.features.has(gate)) continue
      this.send(member.socket, message)
    }
  }

  private broadcastWith(
    roomId: string,
    exceptPeerId: string | undefined,
    build: (member: Member) => ServerMessage | null
  ): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    for (const member of room.values()) {
      if (member.peerId === exceptPeerId) continue
      const message = build(member)
      if (message) this.send(member.socket, message)
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }
}

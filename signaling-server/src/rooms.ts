import { WebSocket } from 'ws'
import {
  isSignalPayload,
  isStreamId,
  isStreamMeta,
  type PeerInfo,
  type ServerMessage,
  type SignalPayload,
  type StreamMeta,
  type WatcherInfo
} from './types.js'

export interface Member {
  socket: WebSocket
  peerId: string
  displayName: string
  roomId: string
  streams: Map<string, StreamMeta>
  watchers: Map<string, Set<string>>
  isAlive: boolean
}

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/
const PEER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class RoomHub {
  private rooms = new Map<string, Map<string, Member>>()
  private bySocket = new Map<WebSocket, Member>()

  roomCount(): number {
    return this.rooms.size
  }

  join(
    socket: WebSocket,
    roomId: string,
    peerId: string,
    displayName: string
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
    }
    const existing = room.get(peerId)
    if (existing) {
      if (existing.socket.readyState === WebSocket.OPEN) {
        return { ok: false, error: 'Este peer já está na sala.' }
      }
      this.bySocket.delete(existing.socket)
      room.delete(peerId)
    }

    const peers = [...room.values()].map((member) => this.toInfo(room, member))
    const member: Member = {
      socket,
      peerId,
      displayName: name,
      roomId,
      streams: new Map(),
      watchers: new Map(),
      isAlive: true
    }
    room.set(peerId, member)
    this.bySocket.set(socket, member)
    this.send(socket, { type: 'joined', peerId, peers })
    this.broadcast(roomId, { type: 'peer-joined', peer: this.toInfo(room, member) }, peerId)
    console.log(`[${roomId}] ${name} entrou (${room.size})`)
    return { ok: true }
  }

  leave(socket: WebSocket): void {
    const member = this.bySocket.get(socket)
    if (!member) return
    this.bySocket.delete(socket)
    const room = this.rooms.get(member.roomId)
    if (!room) return
    this.dropViewer(room, member.peerId)
    room.delete(member.peerId)
    this.broadcast(member.roomId, { type: 'peer-left', peerId: member.peerId })
    console.log(`[${member.roomId}] ${member.displayName} saiu (${room.size})`)
    if (room.size === 0) this.rooms.delete(member.roomId)
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
    this.broadcast(member.roomId, { type: 'stream-meta', peerId: member.peerId, streamId, meta })
    console.log(`[${member.roomId}] ${member.displayName} transmitindo ${meta.streamType}`)
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
      this.broadcast(member.roomId, {
        type: 'watcher-joined',
        streamId,
        broadcasterId: owner.peerId,
        watcher: { peerId: member.peerId, displayName: member.displayName }
      })
      this.send(owner.socket, { type: 'watch', streamId, viewerId: member.peerId })
      return
    }
    set.delete(member.peerId)
    this.broadcast(member.roomId, {
      type: 'watcher-left',
      streamId,
      broadcasterId: owner.peerId,
      peerId: member.peerId
    })
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
    this.broadcast(member.roomId, {
      type: 'stream-meta',
      peerId: member.peerId,
      streamId,
      meta: null
    })
    console.log(`[${member.roomId}] ${member.displayName} parou ${streamId}`)
  }

  private dropViewer(room: Map<string, Member>, peerId: string): void {
    for (const owner of room.values()) {
      for (const [streamId, set] of owner.watchers) {
        if (!set.delete(peerId)) continue
        this.broadcast(owner.roomId, {
          type: 'watcher-left',
          streamId,
          broadcasterId: owner.peerId,
          peerId
        })
      }
    }
  }

  private ownerOf(room: Map<string, Member>, streamId: string): Member | undefined {
    for (const member of room.values()) {
      if (member.streams.has(streamId)) return member
    }
    return undefined
  }

  private toInfo(room: Map<string, Member>, member: Member): PeerInfo {
    const watchers: PeerInfo['watchers'] = []
    for (const [streamId, ids] of member.watchers) {
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
      streams: [...member.streams.values()],
      watchers
    }
  }

  private require(socket: WebSocket): Member | null {
    const member = this.bySocket.get(socket)
    if (!member) {
      this.send(socket, { type: 'error', message: 'Entre em uma sala antes de enviar mensagens.' })
      return null
    }
    return member
  }

  private broadcast(roomId: string, message: ServerMessage, exceptPeerId?: string): void {
    const room = this.rooms.get(roomId)
    if (!room) return
    for (const member of room.values()) {
      if (member.peerId === exceptPeerId) continue
      this.send(member.socket, message)
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }
}

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, type RawData } from 'ws'
import { RoomHub } from './rooms.js'

const port = Number(process.env.PORT ?? 8080)
const host = process.env.HOST ?? '0.0.0.0'
const MAX_MESSAGE = 65_536

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type'
  })
  res.end(JSON.stringify(body))
}

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? '/').split('?')[0]
  if (req.method === 'OPTIONS') {
    writeJson(res, 204, {})
    return
  }
  if (req.method === 'GET' && path === '/health') {
    writeJson(res, 200, { status: 'ok', rooms: hub.roomCount(), users: hub.members().length })
    return
  }
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*'
  })
  res.end('signaling ok\n')
}

const httpServer = createServer(handleHttp)

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE })
const hub = new RoomHub()

function asText(data: RawData): string {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.concat(data).toString('utf8')
}

wss.on('connection', (socket) => {
  socket.on('pong', () => hub.markAlive(socket))

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      socket.send(JSON.stringify({ type: 'error', message: 'Use mensagens de texto JSON.' }))
      return
    }
    const text = asText(data)
    if (text.length > MAX_MESSAGE) {
      socket.send(JSON.stringify({ type: 'error', message: 'Mensagem grande demais.' }))
      return
    }
    hub.markAlive(socket)

    let message: { type?: string; [key: string]: unknown }
    try {
      message = JSON.parse(text) as { type?: string }
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'JSON inválido.' }))
      return
    }

    switch (message.type) {
      case 'join':
        if (typeof message.roomId !== 'string' || typeof message.peerId !== 'string' || typeof message.displayName !== 'string') {
          socket.send(JSON.stringify({ type: 'error', message: 'Join incompleto.' }))
          return
        }
        {
          const result = hub.join(socket, message.roomId, message.peerId, message.displayName, message.profile)
          if (!result.ok) {
            socket.send(JSON.stringify({ type: 'error', message: result.error }))
          }
        }
        return
      case 'update-profile':
        hub.updateProfile(socket, message.displayName, message.profile)
        return
      case 'leave':
        hub.leave(socket)
        return
      case 'signal':
        hub.signal(socket, String(message.to ?? ''), message.payload)
        return
      case 'stream-meta':
        hub.setStream(socket, message.streamId, message.meta ?? null)
        return
      case 'watch':
        hub.watch(socket, message.streamId, 'watch')
        return
      case 'unwatch':
        hub.watch(socket, message.streamId, 'unwatch')
        return
      case 'ping':
        socket.send(JSON.stringify({ type: 'pong' }))
        return
      default:
        socket.send(JSON.stringify({ type: 'error', message: 'Tipo de mensagem desconhecido.' }))
    }
  })

  socket.on('close', () => hub.leave(socket))
  socket.on('error', () => hub.leave(socket))
})

const heartbeat = setInterval(() => {
  for (const member of hub.members()) {
    if (!member.isAlive) {
      member.socket.terminate()
      continue
    }
    member.isAlive = false
    member.socket.ping()
  }
}, 25_000)

wss.on('close', () => clearInterval(heartbeat))

httpServer.listen(port, host, () => {
  console.log(`Sinalização escutando em ws://${host}:${port}`)
})

import type { ClientMessage, ServerMessage } from '@renderer/types'

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export class SignalingClient {
  private ws: WebSocket | null = null
  private stopped = false
  private attempt = 0
  private timer: number | null = null
  private heartbeat: number | null = null

  onOpen: () => void = () => {}
  onClose: () => void = () => {}
  onMessage: (message: ServerMessage) => void = () => {}
  onStatus: (status: SocketStatus) => void = () => {}

  constructor(private readonly url: string) {}

  start(): void {
    this.stopped = false
    this.open(false)
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  stop(): void {
    this.stopped = true
    this.clearHeartbeat()
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    this.ws?.close()
    this.ws = null
  }

  private open(isRetry: boolean): void {
    this.onStatus(isRetry ? 'reconnecting' : 'connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.scheduleRetry()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.attempt = 0
      this.onStatus('connected')
      this.startHeartbeat()
      this.onOpen()
    }

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      try {
        this.onMessage(JSON.parse(event.data) as ServerMessage)
      } catch {
        console.warn('Mensagem de sinalização ignorada.')
      }
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onclose = () => {
      this.clearHeartbeat()
      if (this.ws === ws) this.ws = null
      this.onClose()
      if (this.stopped) {
        this.onStatus('disconnected')
        return
      }
      this.scheduleRetry()
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    this.heartbeat = window.setInterval(() => {
      this.send({ type: 'ping' })
    }, 25_000)
  }

  private clearHeartbeat(): void {
    if (this.heartbeat !== null) {
      window.clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }

  private scheduleRetry(): void {
    const delay = Math.min(8000, 500 * 2 ** this.attempt)
    this.attempt += 1
    this.onStatus('reconnecting')
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.open(true)
    }, delay)
  }
}

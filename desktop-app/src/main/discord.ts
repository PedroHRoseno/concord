import { app, ipcMain } from 'electron'
import { Client } from 'discord-rpc'

interface PresencePayload {
  inRoom: boolean
  roomName: string
  sharing: boolean
  sourceName: string
}

let clientId = ''
let rpc: Client | null = null
let ready = false
let since: number | null = null
let latest: PresencePayload = { inRoom: false, roomName: '', sharing: false, sourceName: '' }

function clip(value: string, max: number): string {
  const text = value.trim()
  return text.length > max ? text.slice(0, max) : text
}

async function publish(): Promise<void> {
  if (!rpc || !ready) return
  if (!latest.inRoom || !latest.roomName) {
    since = null
    await rpc.clearActivity()
    return
  }
  if (!since) since = Date.now()
  const source = clip(latest.sourceName, 80)
  await rpc.setActivity({
    details: clip(`Na sala: ${latest.roomName}`, 128),
    state: latest.sharing && source ? clip(`Transmitindo: ${source}`, 128) : 'Assistindo amigos',
    startTimestamp: since,
    instance: false
  })
}

function destroyClient(): void {
  ready = false
  const current = rpc
  rpc = null
  if (!current) return
  void current.clearActivity().catch(() => undefined)
  void current.destroy().catch(() => undefined)
}

function connect(nextId: string): void {
  destroyClient()
  clientId = nextId
  if (!clientId) return
  const client = new Client({ transport: 'ipc' })
  rpc = client
  client.on('ready', () => {
    if (rpc !== client) return
    ready = true
    void publish().catch(() => undefined)
  })
  void client.login({ clientId }).catch(() => {
    if (rpc === client) destroyClient()
  })
}

export function registerDiscord(): void {
  ipcMain.handle('discord:client', (_event, value: unknown) => {
    const next = typeof value === 'string' ? value.trim() : ''
    if (next === clientId && (next === '' || rpc)) return
    connect(next)
  })

  ipcMain.handle('discord:presence', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') return
    const payload = value as Partial<PresencePayload>
    const inRoom = payload.inRoom === true
    latest = {
      inRoom,
      roomName: typeof payload.roomName === 'string' ? payload.roomName : '',
      sharing: payload.sharing === true,
      sourceName: typeof payload.sourceName === 'string' ? payload.sourceName : ''
    }
    if (!inRoom) since = null
    void publish().catch(() => undefined)
  })

  app.on('before-quit', () => {
    destroyClient()
  })
}

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import logo from '@renderer/assets/logo.png'
import type { LobbyInput } from '@renderer/types'

const STORAGE_NAME = 'screenshare.displayName'
const STORAGE_ROOM = 'screenshare.roomId'
const STORAGE_URL = 'screenshare.signalingUrl'
const STORAGE_TURN_URLS = 'screenshare.turn.urls'
const STORAGE_TURN_USER = 'screenshare.turn.username'
const STORAGE_TURN_CRED = 'screenshare.turn.credential'
const STORAGE_AUTO = 'screenshare.autoJoin'
const MANUAL_DISCONNECT = 'concord.manualDisconnect'
const DEFAULT_ROOM = 'sala-principal'
const DEFAULT_SIGNALING_URL = 'wss://concord-production-c4a3.up.railway.app'
const ROOM_SHORTCUTS = [
  { label: 'Geral', id: 'geral' },
  { label: 'Jogos', id: 'jogos' },
  { label: 'Sala 2', id: 'sala-2' }
]

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A sala continua utilizável se o armazenamento estiver bloqueado.
  }
}

function productionSignalingUrl(): string | null {
  const built = import.meta.env.VITE_SIGNALING_URL
  if (typeof built === 'string' && (built.startsWith('ws://') || built.startsWith('wss://'))) return built
  return null
}

function initialSignalingUrl(): string {
  const stored = readStorage(STORAGE_URL, '')
  const production = productionSignalingUrl()
  if (import.meta.env.DEV && production) return production
  if (stored.startsWith('ws://') || stored.startsWith('wss://')) return stored
  if (production) return production
  return DEFAULT_SIGNALING_URL
}

function savedSession(): { displayName: string; roomId: string } | null {
  const displayName = readStorage(STORAGE_NAME, '').trim()
  const roomId = readStorage(STORAGE_ROOM, '').trim()
  if (!displayName || !roomId) return null
  return { displayName, roomId }
}

interface LobbyProps {
  error: string | null
  onJoin: (input: LobbyInput) => void
  onDismissError: () => void
}

export function Lobby({ error, onJoin, onDismissError }: LobbyProps) {
  const [displayName, setDisplayName] = useState(() => readStorage(STORAGE_NAME, ''))
  const [roomId, setRoomId] = useState(() => readStorage(STORAGE_ROOM, DEFAULT_ROOM))
  const [signalingUrl, setSignalingUrl] = useState(initialSignalingUrl)
  const [turnUrls, setTurnUrls] = useState(() => readStorage(STORAGE_TURN_URLS, ''))
  const [turnUsername, setTurnUsername] = useState(() => readStorage(STORAGE_TURN_USER, ''))
  const [turnCredential, setTurnCredential] = useState(() => readStorage(STORAGE_TURN_CRED, ''))
  const [autoJoin, setAutoJoin] = useState(() => readStorage(STORAGE_AUTO, '1') !== '0')

  useEffect(() => {
    if (readStorage(STORAGE_NAME, '').trim()) return
    const read = window.electronAPI?.getOsUsername
    if (!read) return
    let cancelled = false
    void read()
      .then((name) => {
        const next = name.trim().slice(0, 32)
        if (!cancelled && next) setDisplayName((current) => (current.trim() ? current : next))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    onDismissError()
  }, [displayName, roomId, signalingUrl, onDismissError])

  useEffect(() => {
    try {
      if (sessionStorage.getItem(MANUAL_DISCONNECT) === '1') return
    } catch {
      return
    }
    const saved = savedSession()
    if (!saved || readStorage(STORAGE_AUTO, '1') === '0') return
    onJoin({
      displayName: saved.displayName,
      roomId: saved.roomId,
      signalingUrl: initialSignalingUrl(),
      turn: {
        urls: readStorage(STORAGE_TURN_URLS, ''),
        username: readStorage(STORAGE_TURN_USER, ''),
        credential: readStorage(STORAGE_TURN_CRED, '')
      }
    })
  }, [onJoin])

  function currentInput(): LobbyInput {
    return {
      displayName,
      roomId,
      signalingUrl,
      turn: { urls: turnUrls, username: turnUsername, credential: turnCredential }
    }
  }

  function persist(input: LobbyInput): void {
    writeStorage(STORAGE_NAME, input.displayName)
    writeStorage(STORAGE_ROOM, input.roomId)
    writeStorage(STORAGE_URL, input.signalingUrl)
    writeStorage(STORAGE_TURN_URLS, input.turn.urls)
    writeStorage(STORAGE_TURN_USER, input.turn.username)
    writeStorage(STORAGE_TURN_CRED, input.turn.credential)
    writeStorage(STORAGE_AUTO, autoJoin ? '1' : '0')
  }

  return (
    <main className="flex h-full items-center justify-center overflow-y-auto bg-app p-6">
      <form
        className="w-full max-w-md rounded-2xl bg-elevated p-6 shadow-2xl ring-1 ring-white/10"
        onSubmit={(event) => {
          event.preventDefault()
          try {
            sessionStorage.removeItem(MANUAL_DISCONNECT)
          } catch {
            // Segue o envio mesmo sem conseguir limpar a sessão.
          }
          const input = currentInput()
          persist(input)
          onJoin(input)
        }}
      >
        <img src={logo} alt="" className="h-16 w-16" />
        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-blurple">Concord</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Entrar na sala</h1>
        <p className="mt-2 text-sm text-muted">Tela, webcam e áudio do aplicativo. Sem chat de texto.</p>

        <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="display-name">
          Nome de exibição
        </label>
        <input
          id="display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={32}
          autoFocus
          autoComplete="nickname"
          className="mt-2 h-11 w-full rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
        />

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="room-id">
          ID da sala
        </label>
        <input
          id="room-id"
          value={roomId}
          onChange={(event) => setRoomId(event.target.value)}
          maxLength={64}
          spellCheck={false}
          autoComplete="off"
          placeholder="sala-principal"
          className="mt-2 h-11 w-full rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {ROOM_SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.id}
              type="button"
              onClick={() => setRoomId(shortcut.id)}
              className={`h-8 rounded-full px-3 text-xs font-semibold ${roomId === shortcut.id ? 'bg-blurple text-white' : 'bg-app text-muted ring-1 ring-line hover:text-ink'}`}
            >
              {shortcut.label}
            </button>
          ))}
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={autoJoin}
            onChange={(event) => {
              const next = event.target.checked
              setAutoJoin(next)
              writeStorage(STORAGE_AUTO, next ? '1' : '0')
            }}
            className="h-4 w-4 accent-blurple"
          />
          Entrar automaticamente na sala ao iniciar
        </label>

        <details className="mt-4 rounded-lg bg-app ring-1 ring-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-sm text-muted">
            Avançado: Servidor & TURN
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="space-y-3 px-3 pb-3">
            <label className="block text-xs text-muted" htmlFor="signal-url">
              URL do servidor de sinalização
            </label>
            <input
              id="signal-url"
              value={signalingUrl}
              onChange={(event) => setSignalingUrl(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="h-10 w-full rounded-md bg-elevated px-3 text-sm text-ink ring-1 ring-line"
            />
            <label className="block text-xs text-muted" htmlFor="turn-urls">
              URLs TURN
            </label>
            <input
              id="turn-urls"
              value={turnUrls}
              onChange={(event) => setTurnUrls(event.target.value)}
              spellCheck={false}
              placeholder="turn:seu-servidor:3478"
              className="h-10 w-full rounded-md bg-elevated px-3 text-sm text-ink ring-1 ring-line"
            />
            <label className="block text-xs text-muted" htmlFor="turn-user">
              Usuário
            </label>
            <input
              id="turn-user"
              value={turnUsername}
              onChange={(event) => setTurnUsername(event.target.value)}
              autoComplete="off"
              className="h-10 w-full rounded-md bg-elevated px-3 text-sm text-ink ring-1 ring-line"
            />
            <label className="block text-xs text-muted" htmlFor="turn-credential">
              Senha
            </label>
            <input
              id="turn-credential"
              type="password"
              value={turnCredential}
              onChange={(event) => setTurnCredential(event.target.value)}
              autoComplete="off"
              className="h-10 w-full rounded-md bg-elevated px-3 text-sm text-ink ring-1 ring-line"
            />
          </div>
        </details>

        {error ? (
          <p className="mt-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="mt-6 h-11 w-full rounded-lg bg-blurple text-sm font-semibold text-white hover:bg-[#4752c4]"
        >
          Entrar
        </button>
      </form>
    </main>
  )
}

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

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

const PUBLIC_SIGNALING_URL = 'wss://classification-pete-gear-obviously.trycloudflare.com'

function isPrivateSignaling(url: string): boolean {
  try {
    const host = new URL(url).hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
  } catch {
    return true
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
  if (stored && !isPrivateSignaling(stored)) return stored
  if (production) return production
  if (stored) return stored
  if (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost') {
    return PUBLIC_SIGNALING_URL
  }
  return 'ws://localhost:8080'
}

interface LobbyProps {
  error: string | null
  onJoin: (input: LobbyInput) => void
  onDismissError: () => void
}

export function Lobby({ error, onJoin, onDismissError }: LobbyProps) {
  const [displayName, setDisplayName] = useState(() => readStorage(STORAGE_NAME, ''))
  const [roomId, setRoomId] = useState(() => readStorage(STORAGE_ROOM, ''))
  const [signalingUrl, setSignalingUrl] = useState(initialSignalingUrl)
  const [turnUrls, setTurnUrls] = useState(() => readStorage(STORAGE_TURN_URLS, ''))
  const [turnUsername, setTurnUsername] = useState(() => readStorage(STORAGE_TURN_USER, ''))
  const [turnCredential, setTurnCredential] = useState(() => readStorage(STORAGE_TURN_CRED, ''))

  useEffect(() => {
    onDismissError()
  }, [displayName, roomId, signalingUrl, onDismissError])

  function persist(input: LobbyInput): void {
    localStorage.setItem(STORAGE_NAME, input.displayName)
    localStorage.setItem(STORAGE_ROOM, input.roomId)
    localStorage.setItem(STORAGE_URL, input.signalingUrl)
    localStorage.setItem(STORAGE_TURN_URLS, input.turn.urls)
    localStorage.setItem(STORAGE_TURN_USER, input.turn.username)
    localStorage.setItem(STORAGE_TURN_CRED, input.turn.credential)
  }

  return (
    <main className="flex h-full items-center justify-center bg-app p-6">
      <form
        className="w-full max-w-md rounded-2xl bg-elevated p-6 shadow-2xl ring-1 ring-white/10"
        onSubmit={(event) => {
          event.preventDefault()
          const input: LobbyInput = {
            displayName,
            roomId,
            signalingUrl,
            turn: { urls: turnUrls, username: turnUsername, credential: turnCredential }
          }
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
          placeholder="sala-1"
          className="mt-2 h-11 w-full rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
        />

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="signal-url">
          URL do servidor de sinalização
        </label>
        <input
          id="signal-url"
          value={signalingUrl}
          onChange={(event) => setSignalingUrl(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="mt-2 h-11 w-full rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
        />

        <details className="mt-4 rounded-lg bg-app ring-1 ring-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-sm text-muted">
            Avançado: TURN
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="space-y-3 px-3 pb-3">
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

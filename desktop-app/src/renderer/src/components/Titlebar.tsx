import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import logo from '@renderer/assets/logo.png'
import type { ConnectionStatus } from '@renderer/types'

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Conectando',
  connected: 'Conectado',
  reconnecting: 'Reconectando',
  disconnected: 'Desconectado'
}

const COLORS: Record<ConnectionStatus, string> = {
  connecting: 'bg-warn',
  connected: 'bg-live',
  reconnecting: 'bg-warn',
  disconnected: 'bg-danger'
}

interface TitlebarProps {
  status?: ConnectionStatus
  roomId?: string
  displayName?: string
  peerCount?: number
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const read = window.electronAPI?.isMaximized
    if (read) void read().then(setMaximized).catch(() => undefined)
    return window.electronAPI?.onMaximized?.(setMaximized)
  }, [])

  if (!window.electronAPI?.minimize) return null

  return (
    <div className="no-drag flex h-full shrink-0">
      <button
        type="button"
        aria-label="Minimizar"
        onClick={() => void window.electronAPI?.minimize?.()}
        className="flex h-full w-12 items-center justify-center text-muted hover:bg-white/10 hover:text-ink"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        onClick={() => void window.electronAPI?.toggleMaximize?.().then(setMaximized)}
        className="flex h-full w-12 items-center justify-center text-muted hover:bg-white/10 hover:text-ink"
      >
        {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Fechar"
        onClick={() => void window.electronAPI?.closeWindow?.()}
        className="flex h-full w-12 items-center justify-center text-muted hover:bg-[#ed4245] hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function Titlebar({ status, roomId, displayName, peerCount }: TitlebarProps) {
  const [version, setVersion] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const readVersion = window.electronAPI?.getVersion
    if (readVersion) void readVersion().then(setVersion).catch(() => undefined)
    const stopProgress = window.electronAPI?.onUpdateProgress?.(setProgress)
    const stopReady = window.electronAPI?.onUpdateReady?.(() => {
      setProgress(null)
      setReady(true)
    })
    return () => {
      stopProgress?.()
      stopReady?.()
    }
  }, [])

  return (
    <header className="titlebar-drag flex h-12 shrink-0 items-center border-b border-line bg-elevated">
      <div className="flex min-w-0 flex-1 items-center gap-3 pl-3">
        <img src={logo} alt="" className="h-6 w-6" />
        <span className="text-sm font-semibold text-ink">Concord</span>
        {status ? <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLORS[status]}`} aria-hidden="true" /> : null}
        {status ? <span className="text-sm text-ink">{LABELS[status]}</span> : null}
        {roomId ? <span className="truncate text-sm text-muted">Sala {roomId}</span> : null}
      </div>
      <div className="no-drag flex h-full items-center gap-3 pr-2 text-sm text-muted">
        {version ? <span>v{version}</span> : null}
        {ready ? (
          <button type="button" onClick={() => void window.electronAPI?.installUpdate()} className="font-semibold text-live">
            Nova versão pronta! Reiniciar e atualizar agora
          </button>
        ) : progress !== null ? (
          <span>Baixando {Math.round(progress)}%</span>
        ) : window.electronAPI?.checkForUpdates ? (
          <button type="button" onClick={() => void window.electronAPI?.checkForUpdates()} className="hover:text-ink">
            Verificar atualizações
          </button>
        ) : null}
        {displayName ? <span className="max-w-40 truncate">{displayName}</span> : null}
        {typeof peerCount === 'number' ? (
          <span>
            {peerCount} {peerCount === 1 ? 'pessoa' : 'pessoas'}
          </span>
        ) : null}
      </div>
      <WindowControls />
    </header>
  )
}

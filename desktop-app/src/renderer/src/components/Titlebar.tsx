import { useEffect, useState } from 'react'
import { Copy, Minus, RefreshCw, Square, X } from 'lucide-react'
import logo from '@renderer/assets/logo.png'
import type { ConnectionStatus } from '@renderer/types'
import { UpdateDialog, type UpdateStatus } from '@renderer/components/UpdateDialog'

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
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const pending = update?.phase === 'available' || update?.phase === 'downloading' || update?.phase === 'ready'

  useEffect(() => {
    const api = window.electronAPI
    const readVersion = api?.getVersion
    if (readVersion) void readVersion().then(setVersion).catch(() => undefined)
    const stopStatus = api?.onUpdateStatus?.((status) => {
      if (status.phase === 'checking' || status.phase === 'error') setUpdate(status)
    })
    const stopAvailable = api?.onUpdateAvailable?.((info) => {
      setUpdate({ phase: 'available', version: info.version, notes: info.notes, current: info.current })
    })
    const stopCurrent = api?.onUpdateNotAvailable?.((info) => {
      setUpdate({ phase: 'current', current: info.current })
    })
    const stopProgress = api?.onDownloadProgress?.((progress) => {
      setUpdate((current) => ({
        phase: 'downloading',
        percent: progress.percent,
        version: current?.version,
        notes: current?.notes,
        current: current?.current,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      }))
    })
    const stopReady = api?.onUpdateDownloaded?.((info) => {
      setUpdate((current) => ({
        phase: 'ready',
        version: info.version || current?.version,
        notes: current?.notes,
        current: current?.current
      }))
    })
    return () => {
      stopStatus?.()
      stopAvailable?.()
      stopCurrent?.()
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
        {window.electronAPI?.checkForUpdates ? (
          <button
            type="button"
            onClick={() => {
              setUpdateOpen(true)
              if (!pending) void window.electronAPI?.checkForUpdates?.()
            }}
            title={pending ? 'Há uma atualização do Concord' : 'Procurar uma nova versão do Concord'}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-200 active:scale-95 ${
              pending
                ? 'border-live/60 bg-live/15 text-ink hover:bg-live/25'
                : 'border-white/10 bg-white/5 text-muted hover:border-white/20 hover:bg-white/10 hover:text-ink'
            }`}
          >
            {pending ? (
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
              </span>
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {update?.phase === 'ready' ? 'Reiniciar para atualizar' : update?.phase === 'downloading' ? 'Baixando…' : pending ? 'Atualização disponível' : 'Verificar atualizações'}
          </button>
        ) : null}
        {updateOpen ? <UpdateDialog status={update} onClose={() => setUpdateOpen(false)} /> : null}
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

import { useEffect, useState } from 'react'
import { ArrowLeftRight, LogOut, ScreenShare, Settings, Square, Video } from 'lucide-react'

interface ControlBarProps {
  sharing: boolean
  webcamLive: boolean
  busy: boolean
  onShare: () => void
  onSwap: () => void
  onStop: () => void
  onWebcam: () => void
  onSettings: () => void
  onLeave: () => void
}

export function ControlBar({ sharing, webcamLive, busy, onShare, onSwap, onStop, onWebcam, onSettings, onLeave }: ControlBarProps) {
  const [hotkey, setHotkey] = useState('Alt+S')

  useEffect(() => {
    const read = window.electronAPI?.getHotkey
    if (read) void read().then(setHotkey).catch(() => undefined)
    return window.electronAPI?.onHotkey?.(setHotkey)
  }, [])

  return (
    <div className="flex shrink-0 justify-center px-4 py-3">
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-panel/95 px-3 py-2 shadow-2xl ring-1 ring-white/10">
        {sharing ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onSwap}
              className="dock-rise inline-flex h-10 items-center gap-2 rounded-xl bg-elevated px-3 text-sm text-ink ring-1 ring-line transition-all duration-200 ease-out hover:bg-app active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              Trocar tela/qualidade [{hotkey}]
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onStop}
              className="dock-rise inline-flex h-10 items-center gap-2 rounded-xl bg-danger px-3 text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Square className="h-4 w-4" aria-hidden="true" />
              Parar tela
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onShare}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-blurple px-3 text-sm font-semibold text-white transition-all duration-200 ease-out hover:bg-[#4752c4] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ScreenShare className="h-4 w-4" aria-hidden="true" />
            [{hotkey}] Compartilhar tela
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onWebcam}
          className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all duration-200 ease-out active:scale-95 ${webcamLive ? 'bg-danger text-white' : 'bg-elevated text-ink ring-1 ring-line'}`}
        >
          <Video className="h-4 w-4" aria-hidden="true" />
          {webcamLive ? 'Desligar webcam' : 'Ligar webcam'}
        </button>
        <button
          type="button"
          onClick={onSettings}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-elevated px-3 text-sm text-ink ring-1 ring-line transition-all duration-200 ease-out hover:bg-app active:scale-95"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          Ajustes
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-elevated px-3 text-sm text-ink ring-1 ring-line transition-all duration-200 ease-out hover:bg-app active:scale-95"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sair da sala
        </button>
      </div>
    </div>
  )
}

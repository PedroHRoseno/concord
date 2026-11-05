import { useEffect, useState } from 'react'
import { ArrowLeftRight, AudioWaveform, HeadphoneOff, Headphones, LogOut, Mic, MicOff, RefreshCw, ScreenShare, Settings, Signal, Square, Video } from 'lucide-react'
import { canShareScreen, useMobileLayout } from '@renderer/lib/platform'
import { toggledSuppressorMode, useVoiceProcessing, type SuppressorMode } from '@renderer/lib/suppressor'
import type { ConnectionStatus } from '@renderer/types'

interface ControlBarProps {
  sharing: boolean
  webcamLive: boolean
  micOn: boolean
  deafened: boolean
  busy: boolean
  onToggleMic: () => void
  onToggleDeafen: () => void
  onToggleSuppressor: (mode: SuppressorMode) => void
  onFlipCamera?: () => void
  onShare: () => void
  onSwap: () => void
  onStop: () => void
  onWebcam: () => void
  onSettings: () => void
  onLeave: () => void
  status: ConnectionStatus
  latency: number | null
}

export function ControlBar({ sharing, webcamLive, micOn, deafened, busy, onToggleMic, onToggleDeafen, onToggleSuppressor, onFlipCamera, onShare, onSwap, onStop, onWebcam, onSettings, onLeave, status, latency }: ControlBarProps) {
  const mobile = useMobileLayout()
  const shareScreen = canShareScreen()
  const processing = useVoiceProcessing()
  const [hotkey, setHotkey] = useState('Alt+S')
  const [voiceKeys, setVoiceKeys] = useState({ mute: '', deafen: '' })

  useEffect(() => {
    const read = window.electronAPI?.getHotkey
    if (read) void read().then(setHotkey).catch(() => undefined)
    const readAll = window.electronAPI?.getHotkeys
    if (readAll) void readAll().then((map) => setVoiceKeys({ mute: map.mute, deafen: map.deafen })).catch(() => undefined)
    const stopAll = window.electronAPI?.onHotkeys?.((map) => setVoiceKeys({ mute: map.mute, deafen: map.deafen }))
    const stopShare = window.electronAPI?.onHotkey?.(setHotkey)
    return () => {
      stopAll?.()
      stopShare?.()
    }
  }, [])

  const micTip = `${micOn ? 'Silenciar microfone' : 'Ligar microfone'}${voiceKeys.mute ? ` [${voiceKeys.mute}]` : ''}`
  const deafenTip = `${deafened ? 'Ativar o áudio' : 'Ensurdecer'}${voiceKeys.deafen ? ` [${voiceKeys.deafen}]` : ''}`
  const hit = mobile ? 'h-12 px-4' : 'h-11 px-4'
  const icon = 'h-5 w-5'
  const signal =
    status === 'connected' ? 'text-emerald-400' : status === 'reconnecting' || status === 'connecting' ? 'text-amber-300' : 'text-red-400'
  const signalLabel =
    status === 'connected' ? 'Voz conectada' : status === 'reconnecting' ? 'Reconectando' : status === 'connecting' ? 'Conectando' : 'Desconectado'

  return (
    <div className="flex shrink-0 items-center justify-center px-4 py-3">
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-panel/95 p-2 shadow-2xl ring-1 ring-white/10">
        <span className="inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-ink" title={latency !== null ? `${latency} ms` : signalLabel}>
          <Signal className={`h-5 w-5 ${signal}`} aria-hidden="true" />
          <span className="text-muted">{signalLabel}</span>
          {status === 'connected' && latency !== null ? <span className="text-xs text-muted">{latency} ms</span> : null}
        </span>
        {shareScreen && sharing ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onSwap}
              className={`dock-rise inline-flex ${hit} items-center gap-2 rounded-xl bg-elevated px-3 text-sm text-ink ring-1 ring-line transition-all duration-200 ease-out hover:bg-app active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <ArrowLeftRight className={icon} aria-hidden="true" />
              Trocar tela/qualidade [{hotkey}]
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onStop}
              className={`dock-rise inline-flex ${hit} items-center gap-2 rounded-xl bg-danger px-3 text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`}
            >
              <Square className={icon} aria-hidden="true" />
              Parar tela
            </button>
          </>
        ) : shareScreen ? (
          <button
            type="button"
            disabled={busy}
            onClick={onShare}
            className={`inline-flex ${hit} items-center gap-2 rounded-xl bg-blurple px-3 text-sm font-semibold text-white transition-all duration-200 ease-out hover:bg-[#4752c4] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <ScreenShare className={icon} aria-hidden="true" />
            [{hotkey}] Compartilhar tela
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={onWebcam}
          className={`inline-flex ${hit} items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all duration-200 ease-out active:scale-95 ${webcamLive ? 'bg-danger text-white' : shareScreen ? 'bg-elevated text-ink ring-1 ring-line' : 'bg-blurple text-white'}`}
        >
          <Video className={icon} aria-hidden="true" />
          {webcamLive ? 'Desligar webcam' : 'Ligar webcam'}
        </button>
        {mobile && webcamLive && onFlipCamera ? (
          <button
            type="button"
            disabled={busy}
            onClick={onFlipCamera}
            title="Alternar câmera frontal e traseira"
            aria-label="Alternar câmera frontal e traseira"
            className={`inline-flex ${hit} items-center gap-2 rounded-xl bg-elevated px-3 text-sm text-ink ring-1 ring-line transition-all duration-200 ease-out active:scale-95 disabled:opacity-40`}
          >
            <RefreshCw className={icon} aria-hidden="true" />
            Virar
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleMic}
          title={micTip}
          aria-label={micTip}
          aria-pressed={micOn}
          className={`inline-flex ${hit} w-11 items-center justify-center rounded-xl px-0 transition-all duration-200 ease-out active:scale-95 ${micOn ? 'bg-elevated text-ink ring-1 ring-line' : 'bg-danger/90 text-white'}`}
        >
          {micOn ? <Mic className={icon} aria-hidden="true" /> : <MicOff className={icon} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => onToggleSuppressor(toggledSuppressorMode())}
          title="Supressão de Ruído IA (RNNoise)"
          aria-label="Supressão de Ruído IA (RNNoise)"
          aria-pressed={processing.mode === 'rnnoise'}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 ease-out active:scale-95 ${processing.mode === 'rnnoise' ? 'bg-blurple text-white' : 'bg-elevated text-ink ring-1 ring-line'}`}
        >
          <AudioWaveform className={icon} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleDeafen}
          title={deafenTip}
          aria-label={deafenTip}
          aria-pressed={deafened}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 ease-out active:scale-95 ${deafened ? 'bg-danger/90 text-white' : 'bg-elevated text-ink ring-1 ring-line'}`}
        >
          {deafened ? <HeadphoneOff className={icon} aria-hidden="true" /> : <Headphones className={icon} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={onSettings}
          className={`inline-flex ${hit} items-center gap-2 rounded-xl bg-elevated px-3 text-sm text-ink ring-1 ring-line transition-all duration-200 ease-out hover:bg-app active:scale-95`}
        >
          <Settings className={icon} aria-hidden="true" />
          Ajustes
        </button>
        <button
          type="button"
          onClick={onLeave}
          className={`inline-flex ${hit} items-center gap-2 rounded-xl bg-elevated px-3 text-sm text-ink ring-1 ring-line transition-all duration-200 ease-out hover:bg-app active:scale-95`}
        >
          <LogOut className={icon} aria-hidden="true" />
          Sair da sala
        </button>
      </div>
    </div>
  )
}

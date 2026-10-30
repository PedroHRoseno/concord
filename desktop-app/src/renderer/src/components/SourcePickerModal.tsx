import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppWindow, Monitor, RefreshCw, X } from 'lucide-react'
import {
  AUDIO_BITRATES,
  RESOLUTION_OPTIONS,
  VIDEO_BITRATES,
  type AudioSourceMode,
  type CaptureSettings,
  type ContentHint,
  type ResolutionPreset
} from '@renderer/types'

type SourceTab = 'window' | 'screen'

interface DesktopSource {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
}

interface SourcePickerModalProps {
  mode: 'start' | 'swap'
  embedded?: boolean
  onClose: () => void
  onConfirm: (settings: CaptureSettings) => void
  onStop?: () => void
}

type AudioChoice = 'none' | 'window' | 'system' | 'device'

const fieldClass = 'h-10 w-full rounded-md bg-app px-2 text-sm text-ink ring-1 ring-line'
const STORAGE_RESOLUTION = 'screenshare.capture.resolution'
const STORAGE_FPS = 'screenshare.capture.fps'
const STORAGE_BITRATE = 'screenshare.capture.bitrate'

function readCaptureStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function storedResolution(): ResolutionPreset {
  const value = readCaptureStorage(STORAGE_RESOLUTION)
  return value === '720p' || value === '1080p' || value === '1440p' || value === 'native' ? value : '1080p'
}

function storedFps(): 30 | 60 {
  return readCaptureStorage(STORAGE_FPS) === '30' ? 30 : 60
}

function storedBitrate(): number {
  const value = Number(readCaptureStorage(STORAGE_BITRATE))
  return VIDEO_BITRATES.some((item) => item.value === value) ? value : 12_000_000
}

export function SourcePickerModal({ mode, embedded = false, onClose, onConfirm, onStop }: SourcePickerModalProps) {
  const [tab, setTab] = useState<SourceTab>('window')
  const [sources, setSources] = useState<DesktopSource[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [audioChoice, setAudioChoice] = useState<AudioChoice>('window')
  const [audioDeviceId, setAudioDeviceId] = useState('')
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([])
  const [resolution, setResolution] = useState<ResolutionPreset>(storedResolution)
  const [fps, setFps] = useState<30 | 60>(storedFps)
  const [maxBitrate, setMaxBitrate] = useState<number>(storedBitrate)
  const [audioBitrate, setAudioBitrate] = useState<number>(256_000)
  const [contentHint, setContentHint] = useState<ContentHint>('motion')

  async function loadSources(): Promise<void> {
    setLoading(true)
    setLoadError(null)
    try {
      if (!window.electronAPI) throw new Error('A ponte do Electron não está disponível.')
      const next = await window.electronAPI.getDesktopSources()
      setSources(next)
      setSelectedId((current) => (current && next.some((source) => source.id === current) ? current : null))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Não foi possível listar as telas.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSources()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setAudioChoice((current) => {
      if (current === 'none' || current === 'device') return current
      return tab === 'screen' ? 'system' : 'window'
    })
  }, [tab])

  useEffect(() => {
    if (audioChoice !== 'device') return
    let cancelled = false
    void (async () => {
      try {
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
          probe.getTracks().forEach((track) => track.stop())
        } catch {
          // A lista segue com os nomes que o sistema já autorizou.
        }
        const listed = await navigator.mediaDevices.enumerateDevices()
        const inputs = listed
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Entrada ${index + 1}`
          }))
        if (cancelled) return
        setDevices(inputs)
        setAudioDeviceId((current) => current || inputs[0]?.deviceId || '')
      } catch {
        if (!cancelled) setDevices([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [audioChoice])

  const visible = sources.filter((source) =>
    tab === 'screen' ? source.id.startsWith('screen:') : source.id.startsWith('window:')
  )
  const selected = sources.find((source) => source.id === selectedId) ?? null

  function confirm(): void {
    if (!selected) return
    let audioMode: AudioSourceMode = audioChoice
    if (audioMode === 'window' && selected.id.startsWith('screen:')) audioMode = 'system'
    try {
      localStorage.setItem(STORAGE_RESOLUTION, resolution)
      localStorage.setItem(STORAGE_FPS, String(fps))
      localStorage.setItem(STORAGE_BITRATE, String(maxBitrate))
    } catch {
      // A transmissão segue mesmo se as preferências não puderem ser salvas.
    }
    onConfirm({
      sourceId: selected.id,
      sourceName: selected.name,
      audioMode,
      audioDeviceId,
      resolution,
      fps,
      maxBitrate,
      audioBitrate,
      contentHint
    })
  }

  const node = (
    <div className={embedded ? 'flex h-full flex-col bg-elevated' : 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4'} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        className={
          embedded
            ? 'flex h-full w-full flex-col overflow-hidden bg-elevated'
            : 'modal-pop flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-elevated shadow-2xl ring-1 ring-white/10'
        }
      >
        <header className="titlebar-drag flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="picker-title" className="text-base font-semibold text-ink">
            {mode === 'swap' ? 'Trocar janela e qualidade' : 'Compartilhar tela'}
          </h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="no-drag rounded-md p-1 text-muted hover:bg-app hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex gap-2 border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setTab('window')
              setSelectedId(null)
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${tab === 'window' ? 'bg-app text-ink' : 'text-muted hover:text-ink'}`}
          >
            <AppWindow className="h-4 w-4" aria-hidden="true" />
            Aplicativos/Janelas
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('screen')
              setSelectedId(null)
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${tab === 'screen' ? 'bg-app text-ink' : 'text-muted hover:text-ink'}`}
          >
            <Monitor className="h-4 w-4" aria-hidden="true" />
            Telas inteiras
          </button>
          <button
            type="button"
            onClick={() => void loadSources()}
            className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-app hover:text-ink"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Atualizar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}
          {loading && sources.length === 0 ? <p className="text-sm text-muted">Carregando miniaturas…</p> : null}
          {!loading && visible.length === 0 ? (
            <p className="text-sm text-muted">{tab === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela encontrada.'}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {visible.map((source) => {
                const active = source.id === selectedId
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedId(source.id)}
                    className={`overflow-hidden rounded-xl bg-app text-left ring-2 ${active ? 'ring-blurple' : 'ring-transparent hover:ring-line'}`}
                  >
                    {source.thumbnail ? (
                      <img src={source.thumbnail} alt="" className="aspect-video w-full bg-black object-cover" />
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-black text-xs text-muted">Sem miniatura</div>
                    )}
                    <span className="flex items-center gap-2 px-2 py-2">
                      {source.appIcon ? (
                        <img src={source.appIcon} alt="" className="h-4 w-4" />
                      ) : tab === 'screen' ? (
                        <Monitor className="h-4 w-4 text-muted" aria-hidden="true" />
                      ) : (
                        <AppWindow className="h-4 w-4 text-muted" aria-hidden="true" />
                      )}
                      <span className="truncate text-sm text-ink">{source.name || 'Sem título'}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <footer className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
          <label className="block text-xs text-muted sm:col-span-2">
            Áudio da transmissão
            <select
              value={audioChoice}
              onChange={(event) => setAudioChoice(event.target.value as AudioChoice)}
              className={`${fieldClass} mt-1`}
            >
              <option value="none">Sem áudio</option>
              <option value="window" disabled={tab === 'screen'}>
                Áudio só desta janela
              </option>
              <option value="system">Áudio do sistema</option>
              <option value="device">Dispositivo de entrada</option>
            </select>
            {audioChoice === 'window' ? (
              <span className="mt-1 block text-[11px] leading-4">
                Só o programa da janela escolhida. No Chrome e no Edge entra o navegador inteiro, não uma aba. O som do Concord não entra.
              </span>
            ) : null}
            {audioChoice === 'system' ? (
              <span className="mt-1 block text-[11px] leading-4">
                Tudo o que sai no alto-falante, menos o som do Concord.
              </span>
            ) : null}
          </label>
          {audioChoice === 'device' ? (
            <label className="block text-xs text-muted sm:col-span-2">
              Dispositivo
              <select
                value={audioDeviceId}
                onChange={(event) => setAudioDeviceId(event.target.value)}
                className={`${fieldClass} mt-1`}
              >
                {devices.length === 0 ? <option value="">Nenhum dispositivo encontrado</option> : null}
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs text-muted">
            Prioridade
            <select
              value={contentHint}
              onChange={(event) => setContentHint(event.target.value as ContentHint)}
              className={`${fieldClass} mt-1`}
            >
              <option value="motion">Fluidez (jogos)</option>
              <option value="detail">Nitidez (texto/código)</option>
            </select>
          </label>
          <label className="block text-xs text-muted">
            Resolução
            <select
              value={resolution}
              onChange={(event) => setResolution(event.target.value as ResolutionPreset)}
              className={`${fieldClass} mt-1`}
            >
              {RESOLUTION_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted">
            Taxa de quadros
            <select
              value={fps}
              onChange={(event) => setFps(Number(event.target.value) as 30 | 60)}
              className={`${fieldClass} mt-1`}
            >
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </label>
          <label className="block text-xs text-muted">
            Bitrate máximo
            <select
              value={maxBitrate}
              onChange={(event) => setMaxBitrate(Number(event.target.value))}
              className={`${fieldClass} mt-1`}
            >
              {VIDEO_BITRATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted">
            Áudio
            <select
              value={audioBitrate}
              onChange={(event) => setAudioBitrate(Number(event.target.value))}
              className={`${fieldClass} mt-1`}
            >
              {AUDIO_BITRATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} estéreo
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">
            {onStop ? (
              <button type="button" onClick={onStop} className="mr-auto h-10 rounded-lg bg-danger px-4 text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95">
                Parar transmissão
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm text-muted transition-all duration-200 ease-out hover:bg-app hover:text-ink active:scale-95">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={confirm}
              className="h-10 rounded-lg bg-blurple px-4 text-sm font-semibold text-white transition-all duration-200 ease-out hover:bg-[#4752c4] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mode === 'swap' ? 'Trocar' : 'Transmitir'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
  if (embedded) return node
  return createPortal(node, document.body)
}

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, Info, Keyboard, Mic, MonitorUp, Scaling, UserRound, X } from 'lucide-react'
import { DownloadApkButton } from '@renderer/components/ApkRelease'
import { Avatar } from '@renderer/components/Avatar'
import { ProfileFields } from '@renderer/components/ProfileFields'
import { UpdateDialog, type UpdateStatus } from '@renderer/components/UpdateDialog'
import { readCaptureBitrate, readCaptureFps, readCaptureResolution, readWebcamDeviceId, writeCapturePrefs, writeWebcamDeviceId } from '@renderer/lib/capture-prefs'
import { readPreviews, writePreviews } from '@renderer/lib/chat'
import { applySink, listOutputDevices, readDiscordClientId, readSinkId, writeDiscordClientId, writeSinkId } from '@renderer/lib/playback'
import { canShareScreen, hasHotkeys, hasUpdater, isElectron, useMobileLayout } from '@renderer/lib/platform'
import { ensureVoiceOutput, isVoicePublished, releaseVoiceCapture, useVoiceProcessing, voiceOutput, writeAutoSensitivity, writeInputGain, writeSensitivity, type SuppressorMode } from '@renderer/lib/suppressor'
import { attachLocalMeter, detachLocalMeter, listInputDevices, readInputDeviceId, useMicLevel, useOutputVolume, writeInputDeviceId, writeOutputVolume } from '@renderer/lib/voice'
import { previewSound, readSoundPrefs, writeSoundEnabled, writeSoundVolume, type SoundPreview } from '@renderer/utils/soundEffects'
import { RESOLUTION_OPTIONS, VIDEO_BITRATES, type ResolutionPreset, type UserProfile } from '@renderer/types'

export type SettingsSection = 'profile' | 'voice' | 'video' | 'sounds' | 'hotkeys' | 'appearance' | 'about'

interface SettingsSheetProps {
  initialSection: SettingsSection
  profile: UserProfile
  voiceLive: boolean
  onApplyVoice: (mode: SuppressorMode) => void
  onSaveProfile: (profile: UserProfile) => void
  onSection: (section: SettingsSection) => void
  onClose: () => void
}

const fieldClass = 'mt-2 h-10 w-full rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line'

function acceleratorFrom(event: KeyboardEvent): string | null {
  const key = event.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (parts.length === 0) return null
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

function AppearancePanel() {
  const [zoom, setZoom] = useState(() => window.electronAPI?.getZoomFactor?.() ?? 1)
  const steps = [0.9, 1, 1.15, 1.25, 1.5]
  if (!window.electronAPI?.setZoomFactor) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-ink">Aparência</h2>
        <p className="mt-3 text-sm text-muted">A escala da interface fica disponível no aplicativo de desktop.</p>
      </div>
    )
  }
  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Aparência</h2>
      <p className="mt-2 text-sm text-muted">Escala da interface (zoom). Atalhos: Ctrl + =, Ctrl + - e Ctrl + 0.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => setZoom(window.electronAPI?.setZoomFactor?.(step) ?? step)}
            className={`h-10 rounded-lg px-4 text-sm font-medium ${Math.abs(zoom - step) < 0.01 ? 'bg-blurple text-white' : 'bg-white/10 text-ink hover:bg-white/15'}`}
          >
            {Math.round(step * 100)}%
          </button>
        ))}
      </div>
    </div>
  )
}

function ProfilePanel({ profile, onSave }: { profile: UserProfile; onSave: (profile: UserProfile) => void }) {
  const [draft, setDraft] = useState(profile)
  useEffect(() => setDraft(profile), [profile])
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave(draft)
      }}
    >
      <h2 className="text-xl font-semibold text-ink">Meu perfil</h2>
      <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="settings-name">
        Nome de exibição
      </label>
      <input
        id="settings-name"
        value={draft.displayName}
        maxLength={32}
        onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
        className={fieldClass}
      />
      <div className="mt-5">
        <ProfileFields profile={draft} onChange={setDraft} />
      </div>
      <div className="mt-6 rounded-xl bg-app p-3 ring-1 ring-white/10">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Prévia</p>
        <div className="mt-2 flex items-center gap-3">
          <Avatar name={draft.displayName || '?'} src={draft.avatarDataUrl} accent={draft.accentColor} live size="md" />
          <span className="min-w-0">
            <p className="truncate text-sm font-semibold" style={{ color: draft.accentColor }}>
              {draft.displayName || 'Nome'}
            </p>
            {draft.customStatus ? <p className="truncate text-xs text-muted">{draft.customStatus}</p> : null}
          </span>
        </div>
      </div>
      <button type="submit" className="mt-5 h-10 rounded-lg bg-blurple px-4 text-sm font-semibold text-white">
        Salvar perfil
      </button>
    </form>
  )
}

function SensitivityBar({
  value,
  level,
  disabled,
  onChange
}: {
  value: number
  level: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  function seek(clientX: number): void {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || disabled) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onChange(Math.round(ratio * 100))
  }
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Sensibilidade de entrada"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={`relative mt-3 h-8 touch-none ${disabled ? 'pointer-events-none opacity-40' : 'cursor-pointer'}`}
      onPointerDown={(event) => {
        if (disabled) return
        event.currentTarget.setPointerCapture(event.pointerId)
        seek(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event.clientX)
      }}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onChange(Math.max(0, value - 2))
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onChange(Math.min(100, value + 2))
      }}
    >
      <div className="absolute inset-x-0 top-1/2 flex h-2 -translate-y-1/2 overflow-hidden rounded-full">
        <div className="h-full bg-amber-400" style={{ width: `${value}%` }} />
        <div className="h-full flex-1 bg-emerald-500" />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-l-full bg-white/45"
        style={{ width: `${Math.min(100, Math.round(level * 100))}%` }}
      />
      <div
        className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.35)]"
        style={{ left: `${value}%` }}
      />
    </div>
  )
}

function VoicePanel({ voiceLive, onApplyVoice }: { voiceLive: boolean; onApplyVoice: (mode: SuppressorMode) => void }) {
  const processing = useVoiceProcessing()
  const level = useMicLevel()
  const outputVolume = useOutputVolume()
  const [inputId, setInputId] = useState(readInputDeviceId)
  const [inputs, setInputs] = useState<Array<{ deviceId: string; label: string }>>([])
  const [sinkId, setSinkId] = useState(readSinkId)
  const [outputs, setOutputs] = useState<Array<{ deviceId: string; label: string }>>([])
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let cancel = false
    void listInputDevices()
      .then((devices) => {
        if (!cancel) setInputs(devices)
      })
      .catch(() => undefined)
    void listOutputDevices()
      .then((devices) => {
        if (!cancel) setOutputs(devices)
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    if (voiceLive) return
    let release = (): void => undefined
    let cancel = false
    void ensureVoiceOutput()
      .then((output) => {
        if (cancel || !output) {
          if (!isVoicePublished()) releaseVoiceCapture()
          return
        }
        attachLocalMeter('preview', output)
        release = () => {
          if (isVoicePublished()) return
          detachLocalMeter()
          releaseVoiceCapture()
        }
      })
      .catch(() => undefined)
    return () => {
      cancel = true
      release()
    }
  }, [voiceLive, processing.mode, inputId])

  useEffect(() => {
    if (!testing) return
    const element = document.createElement('audio')
    element.autoplay = true
    const stream = voiceOutput()
    if (stream) element.srcObject = stream
    void element.play().catch(() => undefined)
    void applySink(element, sinkId)
    return () => {
      element.pause()
      element.srcObject = null
    }
  }, [testing, sinkId, processing.mode, inputId])

  const modes: Array<{ id: SuppressorMode; label: string }> = [
    { id: 'rnnoise', label: 'Padrão (RNNoise IA)' },
    { id: 'browser', label: 'Básico (Navegador)' },
    { id: 'off', label: 'Desativado (Estúdio/Música)' }
  ]

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Voz e áudio</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Dispositivo de entrada
          <select
            value={inputId}
            aria-label="Microfone"
            onChange={(event) => {
              const next = event.target.value
              setInputId(next)
              writeInputDeviceId(next)
              void onApplyVoice(processing.mode)
            }}
            className={fieldClass}
          >
            <option value="">Padrão do sistema</option>
            {inputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Volume de entrada
          <span className="mt-2 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={200}
              value={Math.round(processing.inputGain * 100)}
              aria-label="Volume de entrada"
              onChange={(event) => writeInputGain(Number(event.target.value) / 100)}
              className="w-full"
            />
            <span className="w-12 text-right text-xs tabular-nums text-ink">{Math.round(processing.inputGain * 100)}%</span>
          </span>
        </label>
      </div>
      <button
        type="button"
        aria-pressed={testing}
        onClick={() => setTesting((current) => !current)}
        className={`mt-4 h-10 rounded-lg px-3 text-sm font-semibold ${testing ? 'bg-emerald-600 text-white' : 'bg-app text-ink ring-1 ring-line'}`}
      >
        {testing ? 'Parar teste' : 'Testar microfone (ouvir minha voz)'}
      </button>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Dispositivo de saída
          <select
            value={sinkId}
            aria-label="Dispositivo de saída"
            onChange={(event) => {
              const next = event.target.value
              setSinkId(next)
              writeSinkId(next)
            }}
            className={fieldClass}
          >
            <option value="">Padrão do sistema</option>
            {outputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Volume de saída
          <span className="mt-2 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={200}
              value={Math.round(outputVolume * 100)}
              aria-label="Volume de saída"
              onChange={(event) => writeOutputVolume(Number(event.target.value) / 100)}
              className="w-full"
            />
            <span className="w-12 text-right text-xs tabular-nums text-ink">{Math.round(outputVolume * 100)}%</span>
          </span>
        </label>
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Supressão de ruído</p>
      <div className="mt-2 grid gap-2">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            aria-pressed={processing.mode === mode.id}
            onClick={() => void onApplyVoice(mode.id)}
            className={`h-10 rounded-lg px-3 text-left text-sm ${processing.mode === mode.id ? 'bg-blurple text-white' : 'bg-app text-ink ring-1 ring-line'}`}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {processing.degraded && processing.mode === 'rnnoise' ? (
        <p className="mt-2 text-xs text-warn">O RNNoise não carregou neste aparelho. O microfone está no filtro básico.</p>
      ) : null}
      <div className={`mt-5 ${processing.mode === 'off' ? 'pointer-events-none opacity-40' : ''}`}>
        <label className="flex items-center justify-between gap-3 text-sm text-ink">
          Ajustar automaticamente a sensibilidade de entrada
          <input
            type="checkbox"
            checked={processing.auto}
            disabled={processing.mode === 'off'}
            onChange={(event) => writeAutoSensitivity(event.target.checked)}
            className="h-4 w-4 accent-blurple"
          />
        </label>
        <SensitivityBar
          value={processing.sensitivity}
          level={level}
          disabled={processing.mode === 'off' || processing.auto}
          onChange={writeSensitivity}
        />
      </div>
    </div>
  )
}

function VideoPanel() {
  const mobile = useMobileLayout()
  const share = canShareScreen()
  const [resolution, setResolution] = useState<ResolutionPreset>(readCaptureResolution)
  const [fps, setFps] = useState<30 | 60>(readCaptureFps)
  const [bitrate, setBitrate] = useState(readCaptureBitrate)
  const [cameras, setCameras] = useState<Array<{ deviceId: string; label: string }>>([])
  const [cameraId, setCameraId] = useState(readWebcamDeviceId)

  useEffect(() => {
    if (mobile) return
    let cancel = false
    void navigator.mediaDevices
      .enumerateDevices()
      .then((listed) => {
        if (cancel) return
        setCameras(
          listed
            .filter((device) => device.kind === 'videoinput')
            .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Câmera ${index + 1}` }))
        )
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [mobile])

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Transmissão e vídeo</h2>
      {share ? (
        <>
          <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-muted">
            Resolução
            <select
              value={resolution}
              aria-label="Resolução da transmissão"
              onChange={(event) => {
                const next = event.target.value as ResolutionPreset
                setResolution(next)
                writeCapturePrefs(next, fps, bitrate)
              }}
              className={fieldClass}
            >
              {RESOLUTION_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted">
            Quadros por segundo
            <select
              value={fps}
              aria-label="FPS da transmissão"
              onChange={(event) => {
                const next = event.target.value === '30' ? 30 : 60
                setFps(next)
                writeCapturePrefs(resolution, next, bitrate)
              }}
              className={fieldClass}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted">
            Bitrate
            <select
              value={bitrate}
              aria-label="Bitrate da transmissão"
              onChange={(event) => {
                const next = Number(event.target.value)
                setBitrate(next)
                writeCapturePrefs(resolution, fps, next)
              }}
              className={fieldClass}
            >
              {VIDEO_BITRATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted">Neste aparelho a publicação é a câmera. Os presets de tela ficam no aplicativo de desktop.</p>
      )}
      {mobile ? (
        <p className="mt-4 text-sm text-muted">No celular a câmera alterna entre frontal e traseira ao ligar a webcam.</p>
      ) : (
        <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-muted">
          Webcam
          <select
            value={cameraId}
            aria-label="Webcam"
            onChange={(event) => {
              const next = event.target.value
              setCameraId(next)
              writeWebcamDeviceId(next)
            }}
            className={fieldClass}
          >
            <option value="">Padrão do sistema</option>
            {cameras.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function SoundsPanel() {
  const [soundsOn, setSoundsOn] = useState(() => readSoundPrefs().enabled)
  const [soundVolume, setSoundVolume] = useState(() => Math.round(readSoundPrefs().volume * 100))
  const [previews, setPreviews] = useState(readPreviews)
  const samples: Array<{ id: SoundPreview; label: string }> = [
    { id: 'join', label: 'Alguém entrou' },
    { id: 'leave', label: 'Alguém saiu' },
    { id: 'start', label: 'Live começou' },
    { id: 'stop', label: 'Live parou' },
    { id: 'viewer', label: 'Alguém assistindo' },
    { id: 'chat', label: 'Mensagem' }
  ]
  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Sons e notificações</h2>
      <label className="mt-5 flex items-center justify-between gap-3 text-sm text-ink">
        Efeitos sonoros da sala
        <input
          type="checkbox"
          checked={soundsOn}
          onChange={(event) => {
            const next = event.target.checked
            setSoundsOn(next)
            writeSoundEnabled(next)
          }}
          className="h-4 w-4 accent-blurple"
        />
      </label>
      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-muted">
        Volume dos efeitos
        <input
          type="range"
          min={0}
          max={100}
          value={soundVolume}
          aria-label="Volume dos efeitos sonoros"
          onChange={(event) => {
            const next = Number(event.target.value)
            setSoundVolume(next)
            writeSoundVolume(next / 100)
          }}
          className="mt-2 w-full"
        />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {samples.map((sample) => (
          <button
            key={sample.id}
            type="button"
            onClick={() => previewSound(sample.id)}
            className="h-9 rounded-lg bg-app text-xs font-semibold text-ink ring-1 ring-line"
          >
            Testar {sample.label}
          </button>
        ))}
      </div>
      <label className="mt-5 flex items-center justify-between gap-3 text-sm text-ink">
        Pré-visualizar links no chat
        <input
          type="checkbox"
          checked={previews}
          onChange={(event) => {
            setPreviews(event.target.checked)
            writePreviews(event.target.checked)
          }}
          className="h-4 w-4 accent-blurple"
        />
      </label>
    </div>
  )
}

function HotkeyPanel() {
  const [hotkeys, setHotkeys] = useState({ share: 'Alt+S', mute: '', deafen: '' })
  const [listening, setListening] = useState<'share' | 'mute' | 'deafen' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const read = window.electronAPI?.getHotkeys
    if (read) void read().then(setHotkeys).catch(() => undefined)
    return window.electronAPI?.onHotkeys?.(setHotkeys)
  }, [])

  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'Delete') {
        const action = listening
        setListening(null)
        if (action !== 'share') void window.electronAPI?.setHotkeyFor?.(action, '')?.then(() => setProblem(null))
        return
      }
      const next = acceleratorFrom(event)
      if (!next) return
      const action = listening
      setListening(null)
      void window.electronAPI?.setHotkeyFor?.(action, next)?.then((ok) => {
        if (ok) {
          setHotkeys((current) => ({ ...current, [action]: next }))
          setProblem(null)
        } else setProblem('O sistema não aceitou esse atalho, ou ele já está em uso por outra ação.')
      })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening])

  const rows = [
    ['share', 'Compartilhar tela', hotkeys.share || 'Sem atalho'],
    ['mute', 'Mutar microfone', hotkeys.mute || 'Sem atalho'],
    ['deafen', 'Ensurdecer', hotkeys.deafen || 'Sem atalho']
  ] as const

  return (
    <div>
      <h2 className="text-xl font-semibold text-ink">Atalhos de teclado</h2>
      {rows.map(([action, label, value]) => (
        <div key={action} className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setListening(action)}
              className="h-10 flex-1 rounded-lg bg-app text-sm font-semibold text-ink ring-1 ring-line"
            >
              {listening === action ? 'Pressione o atalho…' : value}
            </button>
            <button
              type="button"
              aria-label={`Limpar atalho de ${label}`}
              onClick={() => {
                setListening(null)
                void window.electronAPI?.setHotkeyFor?.(action, '')?.then((ok) => {
                  if (ok) {
                    setHotkeys((current) => ({ ...current, [action]: '' }))
                    setProblem(null)
                  } else setProblem('O sistema não aceitou limpar esse atalho.')
                })
              }}
              className="h-10 w-10 rounded-lg bg-app text-sm text-muted ring-1 ring-line hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      {problem ? <p className="mt-2 text-sm text-danger">{problem}</p> : null}
      <p className="mt-4 text-xs text-muted">Ctrl+Shift+N continua abrindo outra janela.</p>
    </div>
  )
}

function AboutPanel() {
  const [version, setVersion] = useState(import.meta.env.VITE_APP_VERSION ?? '')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [discordId, setDiscordId] = useState(readDiscordClientId)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    void api.getVersion?.().then((value) => {
      if (value) setVersion(value)
    })
    const stopStatus = api.onUpdateStatus?.((status) => setUpdate(status))
    const stopAvailable = api.onUpdateAvailable?.((info) => {
      setUpdate({ phase: 'available', version: info.version, notes: info.notes, current: info.current })
    })
    const stopCurrent = api.onUpdateNotAvailable?.((info) => setUpdate({ phase: 'current', current: info.current }))
    const stopProgress = api.onDownloadProgress?.((progress) => {
      setUpdate((current) => ({ ...(current ?? { phase: 'downloading' }), phase: 'downloading', percent: progress.percent }))
    })
    const stopReady = api.onUpdateDownloaded?.((info) => {
      setUpdate((current) => ({ phase: 'ready', version: info.version || current?.version, notes: current?.notes, current: current?.current }))
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
    <div>
      <h2 className="text-xl font-semibold text-ink">Sobre e atualizações</h2>
      <p className="mt-3 text-sm text-ink">Versão atual: {version ? `v${version}` : '—'}</p>
      {hasUpdater() ? (
        <button
          type="button"
          onClick={() => {
            setUpdateOpen(true)
            void window.electronAPI?.checkForUpdates?.()
          }}
          className="mt-4 h-10 rounded-lg bg-blurple px-4 text-sm font-semibold text-white"
        >
          Verificar atualizações
        </button>
      ) : null}
      <div className="mt-4">
        <DownloadApkButton />
      </div>
      {isElectron() ? (
        <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-muted">
          Client ID do Discord
          <input
            value={discordId}
            aria-label="Client ID do Discord"
            placeholder="Cole o Client ID para a presença"
            onChange={(event) => {
              const next = event.target.value.trim()
              setDiscordId(next)
              writeDiscordClientId(next)
            }}
            onBlur={(event) => {
              void window.electronAPI?.setDiscordClient?.(event.currentTarget.value.trim())
            }}
            className={fieldClass}
          />
        </label>
      ) : null}
      {updateOpen ? <UpdateDialog status={update} onClose={() => setUpdateOpen(false)} /> : null}
    </div>
  )
}

export function SettingsSheet({ initialSection, profile, voiceLive, onApplyVoice, onSaveProfile, onSection, onClose }: SettingsSheetProps) {
  const hotkeys = hasHotkeys()
  const items: Array<{ id: SettingsSection; label: string; icon: typeof UserRound }> = [
    { id: 'profile', label: 'Meu perfil', icon: UserRound },
    { id: 'voice', label: 'Voz e áudio', icon: Mic },
    { id: 'video', label: 'Transmissão e vídeo', icon: MonitorUp },
    { id: 'sounds', label: 'Sons e notificações', icon: Bell },
    { id: 'appearance', label: 'Aparência', icon: Scaling },
    ...(hotkeys ? [{ id: 'hotkeys' as const, label: 'Atalhos de teclado', icon: Keyboard }] : []),
    { id: 'about', label: 'Sobre e atualizações', icon: Info }
  ]
  const [section, setSection] = useState<SettingsSection>(items.some((item) => item.id === initialSection) ? initialSection : 'profile')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 md:p-8" onClick={onClose}>
      <div
        className="flex h-[min(820px,92vh)] w-[min(1080px,96vw)] overflow-hidden rounded-xl bg-[#313338] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="flex w-56 shrink-0 flex-col bg-[#2b2d31] py-4">
          <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Ajustes do usuário</p>
          <nav className="flex flex-col gap-0.5 px-2">
            {items.map((item) => {
              const Icon = item.icon
              const active = section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id)
                    onSection(item.id)
                  }}
                  className={`flex h-9 items-center gap-2 rounded px-2 text-left text-sm font-medium ${active ? 'bg-white/10 text-white' : 'text-muted hover:bg-white/5 hover:text-ink'}`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </button>
              )
            })}
          </nav>
        </aside>
        <div className="relative min-w-0 flex-1 overflow-y-auto bg-[#313338]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="absolute right-4 top-14 text-[10px] font-bold tracking-wide text-muted">ESC</p>
          <div className="mx-auto max-w-xl px-8 py-8 pr-16">
            {section === 'profile' ? <ProfilePanel profile={profile} onSave={onSaveProfile} /> : null}
            {section === 'voice' ? <VoicePanel voiceLive={voiceLive} onApplyVoice={onApplyVoice} /> : null}
            {section === 'video' ? <VideoPanel /> : null}
            {section === 'sounds' ? <SoundsPanel /> : null}
            {section === 'appearance' ? <AppearancePanel /> : null}
            {section === 'hotkeys' ? <HotkeyPanel /> : null}
            {section === 'about' ? <AboutPanel /> : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

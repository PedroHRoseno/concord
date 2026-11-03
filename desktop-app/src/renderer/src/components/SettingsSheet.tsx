import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { hasHotkeys, isElectron } from '@renderer/lib/platform'
import { readSoundPrefs, writeSoundEnabled, writeSoundVolume } from '@renderer/utils/soundEffects'
import { readPreviews, writePreviews } from '@renderer/lib/chat'
import { listInputDevices, readInputDeviceId, writeInputDeviceId } from '@renderer/lib/voice'
import { listOutputDevices, readDiscordClientId, readSinkId, writeDiscordClientId, writeSinkId } from '@renderer/lib/playback'

interface SettingsSheetProps {
  onClose: () => void
}

function acceleratorFrom(event: KeyboardEvent): string | null {
  const key = event.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (parts.length === 0) return null
  const named = key.length === 1 ? key.toUpperCase() : key
  parts.push(named)
  return parts.join('+')
}

type HotkeyAction = 'share' | 'mute' | 'deafen'

export function SettingsSheet({ onClose }: SettingsSheetProps) {
  const [hotkeys, setHotkeys] = useState({ share: 'Alt+S', mute: '', deafen: '' })
  const [listening, setListening] = useState<HotkeyAction | null>(null)
  const [inputId, setInputId] = useState(readInputDeviceId)
  const [inputs, setInputs] = useState<Array<{ deviceId: string; label: string }>>([])
  const [previews, setPreviews] = useState(readPreviews)
  const [problem, setProblem] = useState<string | null>(null)
  const [soundsOn, setSoundsOn] = useState(() => readSoundPrefs().enabled)
  const [soundVolume, setSoundVolume] = useState(() => Math.round(readSoundPrefs().volume * 100))
  const [sinkId, setSinkId] = useState(readSinkId)
  const [outputs, setOutputs] = useState<Array<{ deviceId: string; label: string }>>([])
  const [discordId, setDiscordId] = useState(readDiscordClientId)

  useEffect(() => {
    let cancel = false
    void listOutputDevices()
      .then((devices) => {
        if (!cancel) setOutputs(devices)
      })
      .catch(() => {
        if (!cancel) setOutputs([])
      })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    let cancel = false
    void listInputDevices()
      .then((devices) => {
        if (!cancel) setInputs(devices)
      })
      .catch(() => {
        if (!cancel) setInputs([])
      })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    const read = window.electronAPI?.getHotkeys
    if (read) void read().then(setHotkeys).catch(() => undefined)
    return window.electronAPI?.onHotkeys?.(setHotkeys)
  }, [])

  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'Delete') {
        const action = listening
        setListening(null)
        if (action !== 'share') {
          void window.electronAPI?.setHotkeyFor?.(action, '')?.then(() => setProblem(null))
        }
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
        } else {
          setProblem('O sistema não aceitou esse atalho, ou ele já está em uso por outra ação.')
        }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listening])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="modal-pop max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-elevated p-4 shadow-2xl ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Ajustes</h2>
          <button type="button" onClick={onClose} className="text-muted" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        {hasHotkeys() ? (
          <>
        <p className="text-sm text-muted">Atalho para abrir o compartilhamento de tela.</p>
        <button
          type="button"
          onClick={() => setListening('share')}
          className="mt-3 h-11 w-full rounded-lg bg-app text-sm font-semibold text-ink ring-1 ring-line transition-all duration-200 ease-out active:scale-95"
        >
          {listening === 'share' ? 'Pressione o atalho…' : hotkeys.share}
        </button>
        {(
          [
            ['mute', 'Atalho global para mutar o microfone'],
            ['deafen', 'Atalho global para ensurdecer']
          ] as const
        ).map(([action, label]) => (
          <div key={action} className="mt-4">
            <p className="text-sm text-muted">{label}</p>
            <button
              type="button"
              onClick={() => setListening(action)}
              className="mt-2 h-10 w-full rounded-lg bg-app text-sm font-semibold text-ink ring-1 ring-line transition-all duration-200 ease-out active:scale-95"
            >
              {listening === action ? 'Pressione o atalho… (Esc remove)' : hotkeys[action] || 'Sem atalho'}
            </button>
          </div>
        ))}
        {problem ? <p className="mt-2 text-sm text-danger">{problem}</p> : null}
          </>
        ) : null}
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
        <label className="mt-3 block text-xs text-muted">
          Volume dos efeitos
          <input
            type="range"
            min={0}
            max={100}
            value={soundVolume}
            disabled={!soundsOn}
            aria-label="Volume dos efeitos sonoros"
            onChange={(event) => {
              const next = Number(event.target.value)
              setSoundVolume(next)
              writeSoundVolume(next / 100)
            }}
            className="mt-2 w-full disabled:opacity-40"
          />
        </label>
        <label className="mt-5 block text-xs text-muted">
          Microfone
          <select
            value={inputId}
            aria-label="Microfone"
            onChange={(event) => {
              const next = event.target.value
              setInputId(next)
              writeInputDeviceId(next)
            }}
            className="mt-2 h-10 w-full rounded-lg bg-app px-2 text-sm text-ink ring-1 ring-line"
          >
            <option value="">Padrão do sistema</option>
            {inputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px]">Vale na próxima vez que você ligar o microfone.</span>
        </label>
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
        <label className="mt-5 block text-xs text-muted">
          Dispositivo de saída
          <select
            value={sinkId}
            aria-label="Dispositivo de saída"
            onChange={(event) => {
              const next = event.target.value
              setSinkId(next)
              writeSinkId(next)
            }}
            className="mt-2 h-10 w-full rounded-lg bg-app px-2 text-sm text-ink ring-1 ring-line"
          >
            <option value="">Padrão do sistema</option>
            {outputs.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        {isElectron() ? (
          <>
        <label className="mt-5 block text-xs text-muted">
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
            className="mt-2 h-10 w-full rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
          />
        </label>
        <p className="mt-3 text-xs text-muted">Ctrl+Shift+N continua abrindo outra janela. Sem o Client ID, o Discord fica sem presença.</p>
          </>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

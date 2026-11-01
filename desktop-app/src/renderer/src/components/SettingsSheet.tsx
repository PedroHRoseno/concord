import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { readSoundPrefs, writeSoundEnabled, writeSoundVolume } from '@renderer/utils/soundEffects'
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

export function SettingsSheet({ onClose }: SettingsSheetProps) {
  const [hotkey, setHotkey] = useState('Alt+S')
  const [listening, setListening] = useState(false)
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
    const read = window.electronAPI?.getHotkey
    if (read) void read().then(setHotkey).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      const next = acceleratorFrom(event)
      if (!next) return
      setListening(false)
      void window.electronAPI?.setHotkey?.(next)?.then((ok) => {
        if (ok) {
          setHotkey(next)
          setProblem(null)
        } else {
          setProblem('O sistema não aceitou esse atalho.')
        }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listening])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="modal-pop w-full max-w-md rounded-2xl bg-elevated p-4 shadow-2xl ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Ajustes</h2>
          <button type="button" onClick={onClose} className="text-muted" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted">Atalho para abrir o compartilhamento de tela.</p>
        <button
          type="button"
          onClick={() => setListening(true)}
          className="mt-3 h-11 w-full rounded-lg bg-app text-sm font-semibold text-ink ring-1 ring-line transition-all duration-200 ease-out active:scale-95"
        >
          {listening ? 'Pressione o atalho…' : hotkey}
        </button>
        {problem ? <p className="mt-2 text-sm text-danger">{problem}</p> : null}
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
      </div>
    </div>,
    document.body
  )
}

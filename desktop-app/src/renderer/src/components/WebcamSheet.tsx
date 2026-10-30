import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { WebcamSettings } from '@renderer/types'

interface WebcamSheetProps {
  onClose: () => void
  onConfirm: (settings: WebcamSettings) => void
}

export function WebcamSheet({ onClose, onConfirm }: WebcamSheetProps) {
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([])
  const [deviceId, setDeviceId] = useState('')
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const listed = await navigator.mediaDevices.enumerateDevices()
        const cameras = listed
          .filter((device) => device.kind === 'videoinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Câmera ${index + 1}`
          }))
        if (cancelled) return
        setDevices(cameras)
        setDeviceId(cameras[0]?.deviceId ?? '')
      } catch {
        if (!cancelled) setError('Não foi possível listar as câmeras.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selected = devices.find((device) => device.deviceId === deviceId)

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-2xl bg-elevated p-4 shadow-2xl ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm({
            deviceId,
            deviceLabel: selected?.label || 'Webcam',
            resolution
          })
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Ligar webcam</h2>
          <button type="button" onClick={onClose} className="text-muted" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="block text-xs text-muted">
          Câmera
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            className="mt-1 h-10 w-full rounded-md bg-app px-2 text-sm text-ink ring-1 ring-line"
          >
            {devices.length === 0 ? <option value="">Nenhuma câmera encontrada</option> : null}
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-xs text-muted">
          Resolução
          <select
            value={resolution}
            onChange={(event) => setResolution(event.target.value as '720p' | '1080p')}
            className="mt-1 h-10 w-full rounded-md bg-app px-2 text-sm text-ink ring-1 ring-line"
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <button
          type="submit"
          disabled={devices.length === 0}
          className="mt-4 h-10 w-full rounded-lg bg-blurple text-sm font-semibold text-white disabled:opacity-40"
        >
          Transmitir webcam
        </button>
      </form>
    </div>
  )
}

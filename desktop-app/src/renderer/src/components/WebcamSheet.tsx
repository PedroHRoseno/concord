import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useMobileLayout } from '@renderer/lib/platform'
import { readWebcamDeviceId, writeWebcamDeviceId } from '@renderer/lib/capture-prefs'
import type { WebcamSettings } from '@renderer/types'

interface WebcamSheetProps {
  onClose: () => void
  onConfirm: (settings: WebcamSettings) => void
}

export function WebcamSheet({ onClose, onConfirm }: WebcamSheetProps) {
  const mobile = useMobileLayout()
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([])
  const [deviceId, setDeviceId] = useState('')
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p')
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mobile) return
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
        const saved = readWebcamDeviceId()
        setDeviceId(cameras.some((camera) => camera.deviceId === saved) ? saved : cameras[0]?.deviceId ?? '')
      } catch {
        if (!cancelled) setError('Não foi possível listar as câmeras.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mobile])

  const selected = devices.find((device) => device.deviceId === deviceId)

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="modal-pop w-full max-w-md rounded-2xl bg-elevated p-4 shadow-2xl ring-1 ring-white/10 transition-all duration-200 ease-out"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (!mobile) writeWebcamDeviceId(deviceId)
          onConfirm({
            deviceId: mobile ? '' : deviceId,
            deviceLabel: mobile
              ? facingMode === 'environment'
                ? 'Câmera traseira'
                : 'Câmera frontal'
              : selected?.label || 'Webcam',
            resolution: mobile ? '720p' : resolution,
            facingMode: mobile ? facingMode : undefined
          })
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Ligar webcam</h2>
          <button type="button" onClick={onClose} className="text-muted" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        {mobile ? (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['user', 'Frontal'],
                ['environment', 'Traseira']
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={facingMode === mode}
                onClick={() => setFacingMode(mode)}
                className={`h-12 rounded-lg text-sm font-semibold ${facingMode === mode ? 'bg-blurple text-white' : 'bg-app text-ink ring-1 ring-line'}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
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
        )}
        {mobile ? (
          <p className="mt-3 text-xs text-muted">No celular a câmera sai em 720p, a 30 fps e cerca de 2 Mbps.</p>
        ) : (
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
        )}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <button
          type="submit"
          disabled={!mobile && devices.length === 0}
          className="mt-4 h-12 w-full rounded-lg bg-blurple text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95 disabled:opacity-40"
        >
          Transmitir webcam
        </button>
      </form>
    </div>,
    document.body
  )
}

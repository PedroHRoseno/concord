import { useEffect, useState } from 'react'
import { SourcePickerModal } from '@renderer/components/SourcePickerModal'
import type { CaptureSettings } from '@renderer/types'

export function QuickShare() {
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    const read = window.electronAPI?.getRoomState
    if (read) void read().then((state) => setSharing(state.sharing)).catch(() => undefined)
  }, [])

  return (
    <SourcePickerModal
      embedded
      mode={sharing ? 'swap' : 'start'}
      onClose={() => void window.electronAPI?.cancelQuickShare?.()}
      onStop={sharing ? () => void window.electronAPI?.stopQuickShare?.() : undefined}
      onConfirm={(settings: CaptureSettings) => void window.electronAPI?.confirmQuickShare?.(settings)}
    />
  )
}

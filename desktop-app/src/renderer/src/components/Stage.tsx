import { useEffect, useState } from 'react'
import { StreamCard, type StageEntry } from '@renderer/components/StreamCard'

interface AudioMix {
  volume: number
  muted: boolean
}

interface StageProps {
  entries: StageEntry[]
  layout: 'grid' | 'focus'
  isolateAudio: boolean
  onWatch: (id: string) => void
  onUnwatch: (id: string) => void
}

export function Stage({ entries, layout, isolateAudio, onWatch, onUnwatch }: StageProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [mixes, setMixes] = useState<Record<string, AudioMix>>({})
  const [float, setFloat] = useState({ x: 16, y: 16 })
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    if (focusedId && !entries.some((entry) => entry.id === focusedId)) setFocusedId(null)
  }, [entries, focusedId])

  function mixOf(id: string): AudioMix {
    return mixes[id] ?? { volume: 1, muted: false }
  }

  function updateMix(id: string, patch: Partial<AudioMix>): void {
    setMixes((current) => {
      const previous = current[id] ?? { volume: 1, muted: false }
      return { ...current, [id]: { ...previous, ...patch } }
    })
  }

  function card(entry: StageEntry, fill: boolean, focused: boolean) {
    const locked = isolateAudio && !entry.isSelf
    return (
      <StreamCard
        entry={entry}
        fill={fill}
        focused={focused}
        volume={mixOf(entry.id).volume}
        muted={locked || mixOf(entry.id).muted}
        onVolume={(volume) => updateMix(entry.id, { volume })}
        onMuted={(muted) => updateMix(entry.id, { muted })}
        onWatch={() => onWatch(entry.id)}
        onUnwatch={() => onUnwatch(entry.id)}
        onFocus={() => setFocusedId(entry.id)}
        onExitFocus={() => setFocusedId(null)}
      />
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 pb-24 text-center text-sm text-muted">
        Nenhuma live selecionada. Escolha alguém na lista ou compartilhe sua tela.
      </div>
    )
  }

  const focused = layout === 'focus' ? (entries.find((entry) => entry.id === focusedId) ?? entries[0]) : null
  const overlay =
    focused && focused.meta.streamType === 'screen'
      ? (entries.find((entry) => entry.peerId === focused.peerId && entry.meta.streamType === 'webcam') ?? null)
      : null
  const filmstrip = focused
    ? entries.filter((entry) => entry.id !== focused.id && entry.id !== overlay?.id)
    : []

  if (focused) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative min-h-0 flex-1 p-4 pb-2">
          {card(focused, true, true)}
          {overlay ? (
            <div
              className="absolute z-20 w-80 cursor-grab active:cursor-grabbing"
              style={{ right: float.x, bottom: float.y }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setDrag({ dx: event.clientX, dy: event.clientY })
              }}
              onPointerMove={(event) => {
                if (!drag) return
                setFloat((current) => ({
                  x: Math.max(8, current.x - (event.clientX - drag.dx)),
                  y: Math.max(8, current.y - (event.clientY - drag.dy))
                }))
                setDrag({ dx: event.clientX, dy: event.clientY })
              }}
              onPointerUp={() => setDrag(null)}
            >
              {card(overlay, false, false)}
            </div>
          ) : null}
        </div>
        {filmstrip.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto px-4 pb-24">
            {filmstrip.map((entry) => (
              <div key={entry.id} className="w-72 shrink-0">
                {card(entry, false, false)}
              </div>
            ))}
          </div>
        ) : (
          <div className="h-20" />
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 pb-28">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-4">
        {entries.map((entry) => (
          <div key={entry.id}>{card(entry, false, false)}</div>
        ))}
      </div>
    </div>
  )
}

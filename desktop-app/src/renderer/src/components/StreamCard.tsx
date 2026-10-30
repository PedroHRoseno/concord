import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Eye, GripHorizontal } from 'lucide-react'
import type { StreamMeta, WatcherInfo } from '@renderer/types'
import { formatBitrateCap } from '@renderer/types'
import { VideoStage, type StreamDetails } from '@renderer/components/VideoStage'
import type { DesktopAudioRoute } from '@renderer/lib/audio-loopback'

export interface StageEntry {
  id: string
  name: string
  isSelf: boolean
  meta: StreamMeta
  media: MediaStream | null
  watching: boolean
  pc: RTCPeerConnection | null
  direction: 'inbound' | 'outbound'
  watchers: WatcherInfo[]
  peerId: string
}

interface StreamCardProps {
  entry: StageEntry
  fill: boolean
  focused: boolean
  canvas: boolean
  volume: number
  muted: boolean
  audioRoute: DesktopAudioRoute
  onVolume: (value: number) => void
  onMuted: (value: boolean) => void
  onWatch: () => void
  onUnwatch: () => void
  onFocus: () => void
  onExitFocus: () => void
}

function detailsOf(entry: StageEntry, audioRoute: DesktopAudioRoute): StreamDetails {
  const hint = entry.meta.contentHint === 'motion' ? 'Fluidez' : 'Nitidez'
  const audio =
    entry.isSelf && entry.meta.streamType === 'screen' && audioRoute === 'process'
      ? 'Áudio isolado'
      : entry.isSelf && entry.meta.streamType === 'screen' && audioRoute === 'excluded'
        ? 'Sem o Concord'
        : entry.meta.audio
          ? 'Com áudio'
          : 'Sem áudio'
  return {
    kind: entry.meta.streamType === 'webcam' ? 'Webcam' : 'Tela',
    sourceName: entry.meta.sourceName,
    quality: `${entry.meta.resolution} · ${entry.meta.fps} FPS · ${formatBitrateCap(entry.meta.maxBitrate)} · ${hint}`,
    audio
  }
}

export function StreamCard({
  entry,
  fill,
  focused,
  canvas,
  volume,
  muted,
  audioRoute,
  onVolume,
  onMuted,
  onWatch,
  onUnwatch,
  onFocus,
  onExitFocus
}: StreamCardProps) {
  const [inside, setInside] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const timer = useRef(0)
  const showVideo = entry.isSelf ? Boolean(entry.media) : entry.watching && Boolean(entry.media)
  const connecting = !entry.isSelf && entry.watching && !entry.media
  const watcherNames = entry.watchers.map((watcher) => watcher.displayName).join(', ')
  const chrome = inside || focusWithin
  const label = entry.isSelf ? `${entry.name} (você)` : entry.name

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function reveal(event: PointerEvent<HTMLElement>): void {
    setInside(true)
    window.clearTimeout(timer.current)
    if (event.pointerType === 'touch') timer.current = window.setTimeout(() => setInside(false), 2500)
  }

  function conceal(event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === 'touch') return
    window.clearTimeout(timer.current)
    setInside(false)
  }

  return (
    <article
      className={`relative overflow-hidden rounded-xl bg-black ring-1 ring-white/10 ${fill ? 'h-full w-full' : 'aspect-video w-full'}`}
      onPointerEnter={reveal}
      onPointerMove={reveal}
      onPointerDown={reveal}
      onPointerLeave={conceal}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false)
      }}
    >
      <div className="absolute inset-0">
        {showVideo && entry.media ? (
          <VideoStage
            media={entry.media}
            isSelf={entry.isSelf}
            peerId={entry.peerId}
            volume={volume}
            muted={muted}
            pc={entry.pc}
            direction={entry.direction}
            focused={focused}
            chrome={chrome}
            canvas={canvas}
            details={detailsOf(entry, audioRoute)}
            onVolume={onVolume}
            onMuted={onMuted}
            onFocus={onFocus}
            onExitFocus={onExitFocus}
            onToggleWatch={entry.isSelf ? null : entry.watching ? onUnwatch : onWatch}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-black px-4 text-center text-sm text-muted">
            {connecting ? 'Conectando à transmissão…' : 'Transmissão disponível'}
          </div>
        )}
      </div>
      <div
        className={`stage-drag absolute inset-x-0 top-0 z-30 flex cursor-grab items-start gap-2 px-2.5 pt-2 text-ink transition-opacity duration-200 active:cursor-grabbing ${chrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-950/80 px-2.5 py-1 shadow-md backdrop-blur-md">
          <GripHorizontal className="h-4 w-4 shrink-0 text-white/80" aria-hidden="true" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</h2>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-live shadow-md backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
          Ao vivo
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-xs text-white shadow-md backdrop-blur-md"
          title={entry.watchers.length === 0 ? 'Ninguém assistindo' : watcherNames}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          {entry.watchers.length}
        </span>
      </div>
    </article>
  )
}

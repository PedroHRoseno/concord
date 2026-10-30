import { AudioLines } from 'lucide-react'
import type { StreamMeta, WatcherInfo } from '@renderer/types'
import { formatBitrateCap } from '@renderer/types'
import { VideoStage } from '@renderer/components/VideoStage'

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
  volume: number
  muted: boolean
  onVolume: (value: number) => void
  onMuted: (value: boolean) => void
  onWatch: () => void
  onUnwatch: () => void
  onFocus: () => void
  onExitFocus: () => void
}

export function StreamCard({
  entry,
  fill,
  focused,
  volume,
  muted,
  onVolume,
  onMuted,
  onWatch,
  onUnwatch,
  onFocus,
  onExitFocus
}: StreamCardProps) {
  const hint = entry.meta.contentHint === 'motion' ? 'Fluidez' : 'Nitidez'
  const showVideo = entry.isSelf ? Boolean(entry.media) : entry.watching && Boolean(entry.media)
  const connecting = !entry.isSelf && entry.watching && !entry.media
  const kind = entry.meta.streamType === 'webcam' ? 'Webcam' : 'Tela'
  const watcherNames = entry.watchers.map((watcher) => watcher.displayName).join(', ')

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl bg-elevated ring-1 ring-white/5 ${fill ? 'h-full' : ''}`}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-ink">{entry.isSelf ? `${entry.name} (você)` : entry.name}</h2>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-live/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-live">
              <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
              Ao vivo
            </span>
          </div>
            <p className="truncate text-xs text-muted">
            {kind} · {entry.meta.sourceName} · {entry.meta.resolution} · {entry.meta.fps} FPS · {formatBitrateCap(entry.meta.maxBitrate)} · {hint}
            {entry.meta.audio ? ' · áudio' : ''}
          </p>
          <p className="truncate text-xs text-muted" title={watcherNames}>
            {entry.watchers.length === 0
              ? 'Ninguém assistindo'
              : `${entry.watchers.length} assistindo: ${watcherNames}`}
          </p>
        </div>
        {entry.meta.audio ? <AudioLines className="h-4 w-4 shrink-0 text-muted" aria-label="Áudio do sistema" /> : null}
        {!entry.isSelf ? (
          <button
            type="button"
            onClick={entry.watching ? onUnwatch : onWatch}
            className="shrink-0 rounded-lg bg-blurple px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4752c4]"
          >
            {entry.watching ? 'Parar de assistir' : 'Assistir transmissão'}
          </button>
        ) : null}
      </header>
      <div className={fill ? 'min-h-0 flex-1' : ''}>
        {showVideo && entry.media ? (
          <VideoStage
            media={entry.media}
            isSelf={entry.isSelf}
            peerId={entry.peerId}
            volume={volume}
            muted={muted}
            pc={entry.pc}
            direction={entry.direction}
            fill={fill}
            focused={focused}
            onVolume={onVolume}
            onMuted={onMuted}
            onFocus={onFocus}
            onExitFocus={onExitFocus}
          />
        ) : (
          <div className={`flex items-center justify-center bg-black text-sm text-muted ${fill ? 'h-full' : 'aspect-video'}`}>
            {connecting ? 'Conectando à transmissão…' : 'Transmissão disponível'}
          </div>
        )}
      </div>
    </article>
  )
}

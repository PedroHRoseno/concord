import { Eye, GripHorizontal, Play } from 'lucide-react'
import { Avatar } from '@renderer/components/Avatar'
import { IDLE_MS, useActivity } from '@renderer/hooks/useIdle'
import type { StreamMeta, WatcherInfo } from '@renderer/types'
import { formatBitrateCap } from '@renderer/types'
import { VideoStage, type FloatCam, type StreamDetails } from '@renderer/components/VideoStage'
import type { DesktopAudioRoute } from '@renderer/lib/audio-loopback'
import type { RefObject } from 'react'

export interface StageEntry {
  id: string
  slotKey: string
  name: string
  isSelf: boolean
  avatarDataUrl: string
  accentColor: string
  customStatus: string
  meta: StreamMeta
  media: MediaStream | null
  watching: boolean
  pc: RTCPeerConnection | null
  direction: 'inbound' | 'outbound'
  watchers: WatcherInfo[]
  peerId: string
  reconnecting: boolean
  previewOnly?: boolean
  ghost?: boolean
  poster?: string
}

interface StreamCardProps {
  entry: StageEntry
  fill: boolean
  focused: boolean
  canvas: boolean
  volume: number
  muted: boolean
  audioRoute: DesktopAudioRoute
  webcams: FloatCam[]
  onVolume: (value: number) => void
  onMuted: (value: boolean) => void
  onWatch: () => void
  onUnwatch: () => void
  onHide: () => void
  onFocus: () => void
  onExitFocus: () => void
  fullscreenHost?: RefObject<HTMLElement | null>
  onFrame?: (image: string) => void
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
  webcams,
  onVolume,
  onMuted,
  onWatch,
  onUnwatch,
  onHide,
  onFocus,
  onExitFocus,
  fullscreenHost,
  onFrame
}: StreamCardProps) {
  const { active: chrome, ping, hide } = useActivity(IDLE_MS, true, false)
  const showVideo = !entry.ghost && !entry.previewOnly && (entry.isSelf ? Boolean(entry.media) : entry.watching && Boolean(entry.media))
  const connecting = !entry.isSelf && !entry.ghost && !entry.previewOnly && entry.watching && !entry.media
  const poster = entry.poster || ''
  const accent = entry.accentColor || '#5865F2'
  const watcherNames = entry.watchers.map((watcher) => watcher.displayName).join(', ')
  const label = entry.isSelf ? `${entry.name} (você)` : entry.name

  // O foco do teclado não prende o HUD: só movimento real do mouse, clique ou tecla o revela, e ele some após 2,5s.
  return (
    <article
      className={`relative rounded-xl bg-black ring-1 ring-white/10 ${fill ? 'h-full w-full' : 'aspect-video w-full'}`}
      onPointerEnter={(event) => ping(event.clientX, event.clientY)}
      onPointerMove={(event) => ping(event.clientX, event.clientY)}
      onPointerDown={() => ping()}
      onKeyDown={() => ping()}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') hide()
      }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-xl">
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
            webcams={webcams}
            poster={{
              name: entry.name,
              avatar: entry.avatarDataUrl,
              accent: entry.accentColor,
              peerId: entry.peerId,
              webcam: entry.meta.streamType === 'webcam'
            }}
            onVolume={onVolume}
            onMuted={onMuted}
            onFocus={onFocus}
            onExitFocus={onExitFocus}
            onToggleWatch={entry.isSelf ? null : entry.watching ? onUnwatch : onWatch}
            fullscreenHost={fullscreenHost}
            onFrame={onFrame}
          />
        ) : entry.previewOnly ? (
          <div className="relative h-full w-full overflow-hidden">
            {poster ? (
              <img src={poster} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover blur-md brightness-50" />
            ) : (
              <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${accent} 0%, #09090b 70%)` }}>
                <div className="absolute inset-0 flex items-center justify-center opacity-40 blur-md">
                  <Avatar name={entry.name} src={entry.avatarDataUrl} accent={accent} peerId={entry.peerId} size="lg" />
                </div>
              </div>
            )}
            <div className="relative flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <button
                type="button"
                onClick={onWatch}
                className="stage-no-drag inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 shadow-2xl hover:bg-zinc-100"
              >
                <Play className="h-5 w-5 fill-current" aria-hidden="true" />
                Assistir Transmissão
              </button>
              <p className="max-w-xs truncate text-sm text-white/80">{entry.meta.sourceName}</p>
              <button type="button" onClick={onHide} className="stage-no-drag text-xs font-medium text-white/70 underline-offset-2 hover:text-white hover:underline">
                Ocultar
              </button>
            </div>
          </div>
        ) : entry.ghost ? (
          <div className="relative h-full w-full overflow-hidden">
            {poster ? (
              <img src={poster} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover blur-md brightness-50" />
            ) : (
              <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${accent} 0%, #09090b 72%)` }} />
            )}
            <div className="relative flex h-full items-center justify-center px-6 text-center text-sm font-medium text-white">
              Reconectando transmissão de {entry.name}...
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-black px-4 text-center text-sm text-muted">
            {connecting ? 'Conectando à transmissão…' : 'Transmissão disponível'}
          </div>
        )}
        {entry.reconnecting ? (
          <div className="pointer-events-none absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 text-xs text-white">
            Reconectando...
          </div>
        ) : null}
      </div>
      <div
        className={`stage-drag absolute inset-x-0 top-0 z-30 flex cursor-grab items-start gap-2 px-2.5 pt-2 text-ink transition-opacity duration-200 active:cursor-grabbing ${chrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-950/80 px-2.5 py-1 shadow-md backdrop-blur-md">
          <GripHorizontal className="h-4 w-4 shrink-0 text-white/80" aria-hidden="true" />
          <Avatar name={entry.name} src={entry.avatarDataUrl} accent={entry.accentColor} live size="sm" peerId={entry.peerId} />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{label}</h2>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-live shadow-md backdrop-blur-md">
          <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
          Ao vivo
        </span>
        <span
          className="group relative inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-zinc-950/80 px-2.5 py-1 text-xs text-white shadow-md backdrop-blur-md"
          title={entry.watchers.length === 0 ? 'Ninguém assistindo' : watcherNames}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          {entry.watchers.length}
          {entry.watchers.length > 0 ? (
            <span className="pointer-events-none absolute right-0 top-full z-40 mt-1 hidden w-52 rounded-lg border border-white/10 bg-zinc-950/95 p-2 text-left shadow-md group-hover:block">
              {entry.watchers.map((watcher) => (
                <span key={watcher.peerId} className="flex items-center gap-2 py-1">
                  <Avatar name={watcher.displayName} src={watcher.avatarDataUrl} accent={watcher.accentColor} size="sm" />
                  <span className="truncate text-xs text-white">{watcher.displayName}</span>
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </div>
    </article>
  )
}

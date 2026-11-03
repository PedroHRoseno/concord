import { Monitor, Video, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Avatar } from '@renderer/components/Avatar'
import { setPeerMuted, setPeerVolume, usePeerPrefs } from '@renderer/lib/voice'
import type { LocalPublication, PeerView, PublicProfile, StreamMeta, UserProfile } from '@renderer/types'

interface Person {
  peerId: string
  name: string
  self: boolean
  hasVoice: boolean
  profile: PublicProfile
  streams: Array<{ meta: StreamMeta; watching: boolean }>
}

interface MemberListProps {
  selfName: string
  selfId: string
  selfProfile: UserProfile
  locals: LocalPublication[]
  peers: PeerView[]
  onWatch: (streamId: string) => void
  onUnwatch: (streamId: string) => void
  onEditSelf: () => void
  tab: 'room' | 'chat'
  onTab: (tab: 'room' | 'chat') => void
  unread: number
  chat: ReactNode
  sheet?: boolean
}

function VoiceControls({ name }: { name: string }) {
  const prefs = usePeerPrefs(name)
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={() => setPeerMuted(name, !prefs.muted)}
        title={prefs.muted ? 'Reativar a voz' : 'Silenciar a voz (só para você)'}
        aria-label={prefs.muted ? 'Reativar a voz' : 'Silenciar a voz'}
        aria-pressed={prefs.muted}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${prefs.muted ? 'bg-danger/20 text-danger' : 'text-muted hover:text-ink'}`}
      >
        {prefs.muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
      </button>
      <input
        type="range"
        min={0}
        max={200}
        value={Math.round(prefs.volume * 100)}
        disabled={prefs.muted}
        aria-label={`Volume da voz de ${name}`}
        title={`Voz: ${Math.round(prefs.volume * 100)}%`}
        onChange={(event) => setPeerVolume(name, Number(event.target.value) / 100)}
        className="min-w-0 flex-1 disabled:opacity-40"
      />
    </div>
  )
}

function sourceLine(meta: StreamMeta): string {
  const resolution = meta.resolution === 'native' ? 'Nativa' : meta.resolution
  return `${meta.sourceName} · ${resolution} ${meta.fps}fps`
}

function badge(meta: StreamMeta | undefined): { label: string; className: string } {
  if (!meta) return { label: 'Na sala', className: 'bg-white/10 text-muted' }
  if (meta.streamType === 'webcam') return { label: 'Webcam', className: 'bg-blurple/20 text-blurple' }
  return { label: 'Ao vivo', className: 'bg-live/15 text-live' }
}

const WIDTH_KEY = 'screenshare.sidebar.width'

function readSidebarWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(value)) return Math.min(450, Math.max(200, value))
  } catch {
    /* a largura padrão continua valendo */
  }
  return 256
}

export function MemberList({
  selfName,
  selfId,
  selfProfile,
  locals,
  peers,
  onWatch,
  onUnwatch,
  onEditSelf,
  tab,
  onTab,
  unread,
  chat,
  sheet = false
}: MemberListProps) {
  const [width, setWidth] = useState(readSidebarWidth)
  const drag = useRef<{ x: number; width: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width))
    } catch {
      /* a largura vale nesta sessão */
    }
  }, [width])

  function resize(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = drag.current
    if (!current) return
    setWidth(Math.min(450, Math.max(200, current.width + (current.x - event.clientX))))
  }
  const people: Person[] = [
    {
      peerId: selfId,
      name: selfName,
      self: true,
      hasVoice: false,
      profile: selfProfile,
      streams: locals.map((item) => ({ meta: item.meta, watching: true }))
    },
    ...peers.map((peer) => ({
      peerId: peer.peerId,
      name: peer.displayName,
      self: false,
      hasVoice: peer.hasVoice,
      profile: peer.profile,
      streams: peer.streams.map((item) => ({ meta: item.meta, watching: item.watching }))
    }))
  ]

  return (
    <aside
      className={
        sheet
          ? 'flex max-h-[78vh] w-full flex-col rounded-t-2xl bg-elevated'
          : 'relative flex shrink-0 flex-col border-l border-line bg-elevated'
      }
      style={sheet ? undefined : { width }}
    >
      {sheet ? null : (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar a lista da sala"
        className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, width }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={resize}
        onPointerUp={() => {
          drag.current = null
        }}
      />
      )}
      <div className="flex gap-1 px-3 py-2" role="tablist">
        {(
          [
            ['room', 'Na Sala'],
            ['chat', 'Chat']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors ${sheet ? 'h-11' : 'h-8'} ${tab === id ? 'bg-app text-ink' : 'text-muted hover:text-ink'}`}
          >
            {label}
            {id === 'chat' && unread > 0 ? (
              <span className="min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white">{unread > 99 ? '99+' : unread}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === 'chat' ? chat : null}
      <ul className={`min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3 ${tab === 'room' ? '' : 'hidden'}`}>
        {people.map((person) => {
          const screen = person.streams.find((item) => item.meta.streamType === 'screen')
          const webcam = person.streams.find((item) => item.meta.streamType === 'webcam')
          const primary = badge(screen?.meta ?? webcam?.meta)
          return (
            <li key={person.peerId} className="rounded-xl bg-app px-3 py-3 transition-all duration-200 ease-out">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-left">
                  <Avatar
                    name={person.name}
                    src={person.profile.avatarDataUrl}
                    accent={person.profile.accentColor}
                    live={Boolean(screen || webcam)}
                    peerId={person.peerId}
                    size="sm"
                  />
                  <span className="min-w-0">
                    {person.self ? (
                      <button type="button" onClick={onEditSelf} className="block max-w-full truncate text-left text-sm font-semibold text-ink" title="Editar perfil">
                        {person.name} (você)
                      </button>
                    ) : (
                      <p className="truncate text-sm font-semibold text-ink">{person.name}</p>
                    )}
                    {person.profile.customStatus ? <p className="truncate text-xs text-muted">{person.profile.customStatus}</p> : null}
                  </span>
                </div>
                <span className="flex shrink-0 gap-1">
                  {screen ? (
                    <span className="rounded-full bg-live/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-live">Ao vivo</span>
                  ) : null}
                  {webcam ? (
                    <span className="rounded-full bg-blurple/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-blurple">Webcam</span>
                  ) : null}
                  {!screen && !webcam ? (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${primary.className}`}>{primary.label}</span>
                  ) : null}
                </span>
              </div>
              {screen ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted" title={sourceLine(screen.meta)}>
                  <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{sourceLine(screen.meta)}</span>
                </p>
              ) : null}
              {webcam ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted" title={sourceLine(webcam.meta)}>
                  <Video className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{sourceLine(webcam.meta)}</span>
                </p>
              ) : null}
              {!person.self && person.hasVoice ? <VoiceControls name={person.name} /> : null}
              {!person.self && screen ? (
                <button
                  type="button"
                  onClick={() => (screen.watching ? onUnwatch(screen.meta.streamId) : onWatch(screen.meta.streamId))}
                  className={`mt-2 w-full rounded-lg px-2 font-semibold transition-all duration-200 ease-out active:scale-95 ${sheet ? 'min-h-11 text-sm' : 'py-1.5 text-xs'} ${screen.watching ? 'bg-zinc-700/80 text-white hover:bg-red-500/20 hover:text-red-300' : 'bg-blurple text-white hover:bg-[#4752c4]'}`}
                >
                  {screen.watching ? 'Deixar live' : 'Assistir live'}
                </button>
              ) : null}
              {!person.self && webcam ? (
                <button
                  type="button"
                  onClick={() => (webcam.watching ? onUnwatch(webcam.meta.streamId) : onWatch(webcam.meta.streamId))}
                  className={`mt-2 w-full rounded-lg px-2 font-semibold transition-all duration-200 ease-out active:scale-95 ${sheet ? 'min-h-11 text-sm' : 'py-1.5 text-xs'} ${webcam.watching ? 'bg-zinc-700/80 text-white hover:bg-red-500/20 hover:text-red-300' : 'bg-blurple text-white hover:bg-[#4752c4]'}`}
                >
                  {webcam.watching ? 'Ocultar câmera' : 'Ver câmera'}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

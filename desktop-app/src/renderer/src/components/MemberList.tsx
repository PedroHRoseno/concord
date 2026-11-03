import { Eye, EyeOff, Monitor, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
  liveVolume: (streamId: string) => number
  onLiveVolume: (streamId: string, volume: number) => void
  tab: 'room' | 'chat'
  onTab: (tab: 'room' | 'chat') => void
  unread: number
  chat: ReactNode
  sheet?: boolean
}

function VoiceMenu({ name }: { name: string }) {
  const prefs = usePeerPrefs(name)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>Volume da voz</span>
        <span>{Math.round(prefs.volume * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={200}
        value={Math.round(prefs.volume * 100)}
        disabled={prefs.muted}
        aria-label={`Volume da voz de ${name}`}
        onChange={(event) => setPeerVolume(name, Number(event.target.value) / 100)}
        className="w-full disabled:opacity-40"
      />
      <label className="mt-2 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={prefs.muted}
          onChange={(event) => setPeerMuted(name, event.target.checked)}
          className="h-4 w-4 accent-blurple"
        />
        Mutar usuário
      </label>
    </div>
  )
}

interface MenuState {
  peerId: string
  x: number
  y: number
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
  liveVolume,
  onLiveVolume,
  tab,
  onTab,
  unread,
  chat,
  sheet = false
}: MemberListProps) {
  const [width, setWidth] = useState(readSidebarWidth)
  const [menu, setMenu] = useState<MenuState | null>(null)
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

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function openMenu(person: Person, x: number, y: number): void {
    if (person.self) {
      onEditSelf()
      return
    }
    const live = person.streams.some((item) => item.meta.streamType === 'screen' || item.meta.streamType === 'webcam')
    if (!person.hasVoice && !live) return
    const widthPx = 256
    const heightPx = 280
    setMenu({
      peerId: person.peerId,
      x: Math.max(8, Math.min(x, window.innerWidth - widthPx - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - heightPx - 8))
    })
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
      <ul className={`min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-3 ${tab === 'room' ? '' : 'hidden'}`}>
        {people.map((person) => {
          const screen = person.streams.find((item) => item.meta.streamType === 'screen')
          const webcam = person.streams.find((item) => item.meta.streamType === 'webcam')
          const liveStreams = person.streams.filter((item) => item.meta.streamType === 'screen' || item.meta.streamType === 'webcam')
          const liveLevel = screen ? liveVolume(screen.meta.streamId) : webcam ? liveVolume(webcam.meta.streamId) : 1
          return (
            <li
              key={person.peerId}
              className="group rounded-lg px-2 py-1.5 hover:bg-white/[0.04]"
              onContextMenu={(event) => {
                event.preventDefault()
                openMenu(person, event.clientX, event.clientY)
              }}
            >
              <div className="flex items-center gap-2">
                <Avatar
                  name={person.name}
                  src={person.profile.avatarDataUrl}
                  accent={person.profile.accentColor}
                  live={Boolean(screen || webcam)}
                  peerId={person.peerId}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  {person.self ? (
                    <button type="button" onClick={onEditSelf} className="block max-w-full truncate text-left text-sm font-semibold text-ink" title="Editar perfil">
                      {person.name}
                    </button>
                  ) : (
                    <p className="truncate text-sm font-semibold text-ink">{person.name}</p>
                  )}
                  {person.profile.customStatus ? <p className="truncate text-xs text-muted">{person.profile.customStatus}</p> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {screen ? <span className="rounded bg-live/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-live">AO VIVO</span> : null}
                  {webcam ? <span className="rounded bg-blurple/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-blurple">CÂMERA</span> : null}
                  {!person.self && (person.hasVoice || liveStreams.length > 0) ? (
                    <button
                      type="button"
                      title="Opções"
                      aria-label={`Opções de ${person.name}`}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        openMenu(person, rect.left, rect.bottom + 4)
                      }}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-white/10 hover:text-ink ${sheet ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  ) : null}
                </span>
              </div>
              {screen ? (
                <div className="mt-1 flex items-center gap-1.5 pl-9 text-xs text-muted">
                  <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{screen.meta.sourceName}</span>
                  {!person.self ? (
                    <button
                      type="button"
                      onClick={() => (screen.watching ? onUnwatch(screen.meta.streamId) : onWatch(screen.meta.streamId))}
                      className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-ink hover:bg-white/15"
                    >
                      {screen.watching ? 'Sair' : 'Assistir'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {!person.self && webcam ? (
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => (webcam.watching ? onUnwatch(webcam.meta.streamId) : onWatch(webcam.meta.streamId))}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:bg-white/10 hover:text-ink"
                  >
                    {webcam.watching ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {webcam.watching ? 'Ocultar' : 'Ver'}
                  </button>
                </div>
              ) : null}
              {menu?.peerId === person.peerId
                ? createPortal(
                    <div
                      className="fixed z-[9999] w-64 rounded-lg bg-[#111214] p-3 text-ink shadow-2xl ring-1 ring-white/10"
                      style={{ left: menu.x, top: menu.y }}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      <p className="mb-2 truncate text-sm font-semibold">{person.name}</p>
                      {person.hasVoice ? <VoiceMenu name={person.name} /> : null}
                      {liveStreams.length > 0 ? (
                        <label className="mt-3 block text-xs text-muted">
                          <span className="mb-1 flex items-center justify-between">
                            Volume da live
                            <span>{Math.round(liveLevel * 100)}%</span>
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={300}
                            value={Math.round(liveLevel * 100)}
                            aria-label={`Volume da live de ${person.name}`}
                            onChange={(event) => {
                              const volume = Number(event.target.value) / 100
                              for (const stream of liveStreams) onLiveVolume(stream.meta.streamId, volume)
                            }}
                            className="w-full"
                          />
                        </label>
                      ) : null}
                      {screen ? (
                        <button
                          type="button"
                          onClick={() => (screen.watching ? onUnwatch(screen.meta.streamId) : onWatch(screen.meta.streamId))}
                          className="mt-3 h-8 w-full rounded-md bg-white/10 text-xs font-semibold hover:bg-white/15"
                        >
                          {screen.watching ? 'Deixar live' : 'Assistir live'}
                        </button>
                      ) : null}
                      {webcam ? (
                        <button
                          type="button"
                          onClick={() => (webcam.watching ? onUnwatch(webcam.meta.streamId) : onWatch(webcam.meta.streamId))}
                          className="mt-2 h-8 w-full rounded-md bg-white/10 text-xs font-semibold hover:bg-white/15"
                        >
                          {webcam.watching ? 'Ocultar câmera' : 'Ver câmera'}
                        </button>
                      ) : null}
                    </div>,
                    document.body
                  )
                : null}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

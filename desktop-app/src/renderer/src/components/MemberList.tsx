import { Monitor, Video } from 'lucide-react'
import { Avatar } from '@renderer/components/Avatar'
import type { LocalPublication, PeerView, PublicProfile, StreamMeta, UserProfile } from '@renderer/types'

interface Person {
  peerId: string
  name: string
  self: boolean
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

export function MemberList({ selfName, selfId, selfProfile, locals, peers, onWatch, onUnwatch, onEditSelf }: MemberListProps) {
  const people: Person[] = [
    {
      peerId: selfId,
      name: selfName,
      self: true,
      profile: selfProfile,
      streams: locals.map((item) => ({ meta: item.meta, watching: true }))
    },
    ...peers.map((peer) => ({
      peerId: peer.peerId,
      name: peer.displayName,
      self: false,
      profile: peer.profile,
      streams: peer.streams.map((item) => ({ meta: item.meta, watching: item.watching }))
    }))
  ]

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-line bg-elevated">
      <h2 className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">Na sala</h2>
      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
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
              {!person.self && screen ? (
                <button
                  type="button"
                  onClick={() => (screen.watching ? onUnwatch(screen.meta.streamId) : onWatch(screen.meta.streamId))}
                  className={`mt-2 w-full rounded-lg px-2 py-1.5 text-xs font-semibold transition-all duration-200 ease-out active:scale-95 ${screen.watching ? 'bg-zinc-700/80 text-white hover:bg-red-500/20 hover:text-red-300' : 'bg-blurple text-white hover:bg-[#4752c4]'}`}
                >
                  {screen.watching ? 'Deixar live' : 'Assistir live'}
                </button>
              ) : null}
              {!person.self && webcam ? (
                <button
                  type="button"
                  onClick={() => (webcam.watching ? onUnwatch(webcam.meta.streamId) : onWatch(webcam.meta.streamId))}
                  className={`mt-2 w-full rounded-lg px-2 py-1.5 text-xs font-semibold transition-all duration-200 ease-out active:scale-95 ${webcam.watching ? 'bg-zinc-700/80 text-white hover:bg-red-500/20 hover:text-red-300' : 'bg-blurple text-white hover:bg-[#4752c4]'}`}
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

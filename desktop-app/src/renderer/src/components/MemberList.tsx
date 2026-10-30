import type { LocalPublication, PeerView, StreamMeta } from '@renderer/types'

interface Person {
  peerId: string
  name: string
  self: boolean
  streams: Array<{ meta: StreamMeta; watching: boolean }>
}

interface MemberListProps {
  selfName: string
  selfId: string
  locals: LocalPublication[]
  peers: PeerView[]
  onWatch: (streamId: string) => void
  onUnwatch: (streamId: string) => void
}

function badge(meta: StreamMeta | undefined): { label: string; className: string } {
  if (!meta) return { label: 'Na sala', className: 'bg-white/10 text-muted' }
  if (meta.streamType === 'webcam') return { label: 'Webcam', className: 'bg-blurple/20 text-blurple' }
  return { label: 'Ao vivo', className: 'bg-live/15 text-live' }
}

export function MemberList({ selfName, selfId, locals, peers, onWatch, onUnwatch }: MemberListProps) {
  const people: Person[] = [
    {
      peerId: selfId,
      name: selfName,
      self: true,
      streams: locals.map((item) => ({ meta: item.meta, watching: true }))
    },
    ...peers.map((peer) => ({
      peerId: peer.peerId,
      name: peer.displayName,
      self: false,
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
            <li key={person.peerId} className="rounded-xl bg-app px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-ink">{person.self ? `${person.name} (você)` : person.name}</p>
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
              {!person.self && screen ? (
                <button
                  type="button"
                  onClick={() => (screen.watching ? onUnwatch(screen.meta.streamId) : onWatch(screen.meta.streamId))}
                  className="mt-2 w-full rounded-lg bg-blurple px-2 py-1.5 text-xs font-semibold text-white"
                >
                  {screen.watching ? 'Parar tela' : 'Assistir tela'}
                </button>
              ) : null}
              {!person.self && webcam ? (
                <button
                  type="button"
                  onClick={() => (webcam.watching ? onUnwatch(webcam.meta.streamId) : onWatch(webcam.meta.streamId))}
                  className="mt-2 w-full rounded-lg bg-elevated px-2 py-1.5 text-xs font-semibold text-ink ring-1 ring-line"
                >
                  {webcam.watching ? 'Parar webcam' : 'Assistir webcam'}
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

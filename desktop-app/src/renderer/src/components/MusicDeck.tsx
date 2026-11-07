import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ListMusic, Music, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import type { MusicState } from '@renderer/types'

interface MusicDeckProps {
  state: MusicState | null
  selfId: string
  busy: boolean
  localOnly: boolean
  volume: number
  muted: boolean
  onAdd: (url: string) => void
  onVote: () => void
  onForce: () => void
  onVolume: (value: number) => void
  onToggleMute: () => void
}

export function MusicDeck({ state, selfId, busy, localOnly, volume, muted, onAdd, onVote, onForce, onVolume, onToggleMute }: MusicDeckProps) {
  const [queueOpen, setQueueOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const current = state?.current ?? null
  const queue = state?.queue ?? []
  const votes = state?.votes ?? []
  const needed = state?.needed ?? 1
  const owner = current?.addedBy === selfId
  const voted = votes.includes(selfId)

  function submit(event: FormEvent): void {
    event.preventDefault()
    const url = draft.trim()
    if (!url || busy) return
    onAdd(url)
    setDraft('')
  }

  const card = (
    <section className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-2xl bg-panel/95 p-3 shadow-2xl ring-1 ring-white/10">
      {current?.artwork ? (
        <img src={current.artwork} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted">
          <Music className="h-6 w-6" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{current ? current.title : 'Nenhuma música na fila'}</p>
        <p className="truncate text-xs text-muted">
          {current ? `${current.artist || 'YouTube'} · ${current.addedByName}` : 'Cole um link do YouTube ou do Spotify'}
        </p>
        {current ? (
          <span className="mt-1 flex h-3 items-end gap-0.5" aria-hidden="true">
            {[0, 1, 2, 3].map((bar) => (
              <span
                key={bar}
                className="w-0.5 animate-pulse rounded-full bg-blurple"
                style={{ height: `${8 + ((bar * 3) % 5)}px`, animationDelay: `${bar * 120}ms` }}
              />
            ))}
          </span>
        ) : null}
        {localOnly && owner ? <p className="mt-1 text-[11px] text-muted">Tocando neste aparelho. No computador a sala também escuta.</p> : null}
      </div>
      {current ? (
        <button
          type="button"
          onClick={owner ? onForce : onVote}
          disabled={!owner && voted}
          className="inline-flex h-10 items-center gap-1 rounded-xl bg-white/10 px-3 text-xs font-semibold text-ink hover:bg-white/15 disabled:opacity-50"
        >
          <SkipForward className="h-4 w-4" aria-hidden="true" />
          {owner ? 'Pular' : voted ? 'Voto enviado' : `Pular ${votes.length}/${needed}`}
        </button>
      ) : null}
      <button type="button" onClick={onToggleMute} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink hover:bg-white/10" aria-label={muted ? 'Ativar música' : 'Mutar música'}>
        {muted || volume === 0 ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
      </button>
      <input
        id="music-volume"
        aria-label="Volume da música"
        type="range"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(event) => onVolume(Number(event.target.value) / 100)}
        className="w-20 accent-blurple"
      />
      <button
        type="button"
        onClick={() => setQueueOpen(true)}
        className="inline-flex h-10 items-center gap-1 rounded-xl bg-white/10 px-3 text-xs font-semibold text-ink hover:bg-white/15"
      >
        <ListMusic className="h-4 w-4" aria-hidden="true" />
        Fila{queue.length > 0 ? ` ${queue.length}` : ''}
      </button>
    </section>
  )

  const queueModal = queueOpen
    ? createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="music-queue-title" className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-elevated p-4 ring-1 ring-line">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="music-queue-title" className="text-base font-semibold text-ink">
                Fila de reprodução
              </h2>
              <button type="button" onClick={() => setQueueOpen(false)} className="rounded-lg p-2 text-muted hover:bg-white/10 hover:text-ink" aria-label="Fechar fila">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit} className="mb-3 flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Link do YouTube ou Spotify"
                className="h-10 min-w-0 flex-1 rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
              />
              <button type="submit" disabled={busy || !draft.trim()} className="h-10 rounded-lg bg-blurple px-3 text-sm font-semibold text-white disabled:opacity-40">
                {busy ? '...' : 'Adicionar'}
              </button>
            </form>
            <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {current ? (
                <li className="rounded-xl bg-white/5 px-3 py-2 text-sm">
                  <span className="block truncate font-medium text-ink">Tocando: {current.title}</span>
                  <span className="block truncate text-xs text-muted">{current.addedByName}</span>
                </li>
              ) : (
                <li className="text-sm text-muted">A fila está vazia.</li>
              )}
              {queue.map((track, index) => (
                <li key={track.id} className="rounded-xl bg-white/5 px-3 py-2 text-sm">
                  <span className="block truncate text-ink">
                    {index + 1}. {track.title}
                  </span>
                  <span className="block truncate text-xs text-muted">{track.addedByName}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>,
        document.body
      )
    : null

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">{card}</div>
      {queueModal}
    </>
  )
}

import { useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ListMusic, Music, Plus, Search, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import type { MusicState } from '@renderer/types'

type MusicSearchResult = Awaited<ReturnType<NonNullable<Window['electronAPI']>['searchMusic']>>['results'][number]

function looksLikeLink(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^(www\.|m\.)?(youtube\.com|youtu\.be|music\.youtube\.com|open\.spotify\.com)\//i.test(value)
}

interface MusicDeckProps {
  state: MusicState | null
  selfId: string
  busy: boolean
  blocked: boolean
  volume: number
  muted: boolean
  onAdd: (url: string) => void
  onVote: () => void
  onForce: () => void
  onVolume: (value: number) => void
  onToggleMute: () => void
  onResume: () => void
}

function SyncOverlay({ onResume, className }: { onResume: () => void; className: string }) {
  return (
    <button type="button" onClick={onResume} className={className}>
      🎵 Clique aqui para sincronizar o Jukebox
    </button>
  )
}

export function MusicDeck({ state, selfId, busy, blocked, volume, muted, onAdd, onVote, onForce, onVolume, onToggleMute, onResume }: MusicDeckProps) {
  const [queueOpen, setQueueOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [results, setResults] = useState<MusicSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const searchSeq = useRef(0)
  const canSearch = Boolean(window.electronAPI?.searchMusic)
  const current = state?.current ?? null
  const queue = state?.queue ?? []
  const votes = state?.votes ?? []
  const needed = state?.needed ?? 1
  const owner = current?.addedBy === selfId
  const voted = votes.includes(selfId)

  function closeQueue(): void {
    setQueueOpen(false)
    setResults(null)
    setSearchError('')
  }

  async function search(query: string): Promise<void> {
    const seq = ++searchSeq.current
    setSearching(true)
    setSearchError('')
    try {
      const reply = await window.electronAPI?.searchMusic(query)
      if (seq !== searchSeq.current) return
      if (!reply?.ok) {
        setResults(null)
        setSearchError('A busca do YouTube não respondeu. Tente de novo ou cole o link.')
        return
      }
      setResults(reply.results)
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    const value = draft.trim()
    if (!value || busy) return
    if (canSearch && !looksLikeLink(value)) {
      void search(value)
      return
    }
    onAdd(value)
    setDraft('')
    setResults(null)
  }

  function pick(result: MusicSearchResult): void {
    if (busy) return
    onAdd(`https://www.youtube.com/watch?v=${result.videoId}`)
  }

  const card = (
    <section aria-label="Jukebox" className="relative w-full shrink-0 border-b border-line px-3 py-3">
      {blocked && current ? (
        <SyncOverlay onResume={onResume} className="absolute inset-0 z-10 flex items-center justify-center bg-blurple px-3 text-center text-xs font-semibold leading-snug text-white" />
      ) : null}
      <div inert={blocked && current ? true : undefined}>
        <div className="flex items-start gap-2">
          {current?.artwork ? (
            <img src={current.artwork} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted">
              <Music className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{current ? current.title : 'Nenhuma música na fila'}</p>
            <p className="truncate text-xs text-muted">
              {current ? `${current.artist || 'YouTube'} · ${current.addedByName}` : canSearch ? 'Abra a fila para pesquisar uma música' : 'Cole um link do YouTube ou do Spotify'}
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
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {current ? (
            <button
              type="button"
              onClick={owner ? onForce : onVote}
              disabled={!owner && voted}
              className="inline-flex h-9 min-w-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-ink hover:bg-white/15 disabled:opacity-50"
            >
              <SkipForward className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{owner ? 'Pular' : voted ? 'Voto enviado' : `Pular ${votes.length}/${needed}`}</span>
            </button>
          ) : null}
          <button type="button" onClick={onToggleMute} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-white/10" aria-label={muted ? 'Ativar música' : 'Mutar música'}>
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
            className="h-9 min-w-16 flex-1 basis-16 accent-blurple"
          />
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 text-xs font-semibold text-ink hover:bg-white/15"
          >
            <ListMusic className="h-3.5 w-3.5" aria-hidden="true" />
            Fila{queue.length > 0 ? ` ${queue.length}` : ''}
          </button>
        </div>
      </div>
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
              <button type="button" onClick={closeQueue} className="rounded-lg p-2 text-muted hover:bg-white/10 hover:text-ink" aria-label="Fechar fila">
                <X className="h-4 w-4" />
              </button>
            </div>
            {blocked && current ? (
              <SyncOverlay onResume={onResume} className="mb-3 flex h-12 w-full items-center justify-center rounded-xl bg-blurple px-4 text-center text-sm font-semibold text-white" />
            ) : null}
            <form onSubmit={submit} className="mb-3 flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={canSearch ? 'Pesquisar música ou colar link' : 'Link do YouTube ou Spotify'}
                aria-label={canSearch ? 'Pesquisar música ou colar link' : 'Link do YouTube ou Spotify'}
                className="h-10 min-w-0 flex-1 rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
              />
              <button
                type="submit"
                disabled={busy || searching || !draft.trim()}
                className="inline-flex h-10 items-center gap-1 rounded-lg bg-blurple px-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {canSearch && !looksLikeLink(draft.trim()) ? <Search className="h-4 w-4" aria-hidden="true" /> : null}
                {busy || searching ? '...' : canSearch && !looksLikeLink(draft.trim()) ? 'Buscar' : 'Adicionar'}
              </button>
            </form>
            {searchError ? <p className="mb-3 text-xs text-red-400">{searchError}</p> : null}
            {results ? (
              <div className="mb-3 flex min-h-0 flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">Resultados</span>
                  <button type="button" onClick={() => setResults(null)} className="text-xs text-muted hover:text-ink">
                    Fechar busca
                  </button>
                </div>
                {results.length === 0 ? (
                  <p className="text-sm text-muted">Nada encontrado.</p>
                ) : (
                  <ul className="max-h-72 space-y-1 overflow-y-auto">
                    {results.map((result) => (
                      <li key={result.videoId}>
                        <button
                          type="button"
                          onClick={() => pick(result)}
                          disabled={busy}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10 disabled:opacity-50"
                        >
                          <img src={result.thumbnail} alt="" className="h-9 w-16 shrink-0 rounded object-cover" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">{result.title}</span>
                            <span className="block truncate text-xs text-muted">
                              {result.channel} · {result.duration}
                            </span>
                          </span>
                          <Plus className="h-4 w-4 shrink-0 text-muted" aria-label="Adicionar à fila" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
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
      {card}
      {queueModal}
    </>
  )
}

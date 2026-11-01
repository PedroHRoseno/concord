import { CheckCircle2, Download, Loader2, X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ReleaseNotes } from '@renderer/components/ReleaseNotes'

export interface UpdateStatus {
  phase: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'ready' | 'error'
  current?: string
  version?: string
  notes?: string
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  message?: string
}

interface UpdateDialogProps {
  status: UpdateStatus | null
  onClose: () => void
}

function megabytes(value: number | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '0 MB'
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function UpdateDialog({ status, onClose }: UpdateDialogProps) {
  const phase = status?.phase ?? 'checking'
  const percent = Math.max(0, Math.min(100, status?.percent ?? 0))

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="modal-pop w-full max-w-md rounded-2xl bg-elevated p-4 shadow-2xl ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="update-title" className="text-base font-semibold text-ink">
            Atualização
          </h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded-lg p-1 text-muted transition-all duration-200 ease-out hover:bg-app hover:text-ink active:scale-95">
            <X className="h-4 w-4" />
          </button>
        </div>

        {phase === 'checking' || phase === 'idle' ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Procurando atualizações…
          </p>
        ) : null}

        {phase === 'current' ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-live">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            Você já está na versão mais recente!
          </p>
        ) : null}

        {phase === 'error' ? <p className="mt-4 text-sm text-danger">{status?.message || 'Não foi possível procurar atualizações.'}</p> : null}

        {phase === 'available' ? (
          <div className="mt-4">
            <p className="text-sm text-ink">Nova versão disponível (v{status?.version || '—'})! Deseja baixar agora?</p>
            {status?.notes ? (
              <div className="mt-3 max-h-48 overflow-y-auto rounded-xl bg-app px-3 py-2 text-sm leading-6 text-muted">
                <ReleaseNotes notes={status.notes} />
              </div>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => window.electronAPI?.startDownload?.()}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-blurple text-sm font-semibold text-white transition-all duration-200 ease-out hover:bg-[#4752c4] active:scale-95"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Baixar
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-10 flex-1 rounded-lg bg-app text-sm font-semibold text-ink ring-1 ring-line transition-all duration-200 ease-out hover:bg-panel active:scale-95"
              >
                Depois
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'error' ? (
          <button
            type="button"
            onClick={() => void window.electronAPI?.checkForUpdates?.()}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blurple text-sm font-semibold text-white transition-all duration-200 ease-out hover:bg-[#4752c4] active:scale-95"
          >
            Tentar de novo
          </button>
        ) : null}

        {phase === 'downloading' ? (
          <div className="mt-4">
            <p className="text-sm text-ink">Baixando atualização... {Math.round(percent)}%</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-app">
              <div className="h-full rounded-full bg-blurple transition-all duration-200 ease-out" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">
              {megabytes(status?.bytesPerSecond)}/s · {megabytes(status?.transferred)} de {megabytes(status?.total)}
            </p>
          </div>
        ) : null}

        {phase === 'ready' ? (
          <div className="mt-4">
            <p className="text-sm text-ink">Atualização pronta! O Concord fecha, atualiza em poucos segundos e abre sozinho.</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => window.electronAPI?.installUpdate?.()}
                className="h-10 rounded-lg bg-live text-sm font-semibold text-white transition-all duration-200 ease-out active:scale-95"
              >
                Reiniciar e Instalar Agora
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-lg bg-app text-sm font-semibold text-ink ring-1 ring-line transition-all duration-200 ease-out hover:bg-panel active:scale-95"
              >
                Mais Tarde
              </button>
            </div>
          </div>
        ) : null}

        {status?.current && phase === 'current' ? <p className="mt-2 text-xs text-muted">Versão instalada: v{status.current}</p> : null}
      </div>
    </div>,
    document.body
  )
}

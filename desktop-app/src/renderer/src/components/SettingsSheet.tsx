import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface SettingsSheetProps {
  onClose: () => void
}

function acceleratorFrom(event: KeyboardEvent): string | null {
  const key = event.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (parts.length === 0) return null
  const named = key.length === 1 ? key.toUpperCase() : key
  parts.push(named)
  return parts.join('+')
}

export function SettingsSheet({ onClose }: SettingsSheetProps) {
  const [hotkey, setHotkey] = useState('Alt+S')
  const [listening, setListening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const read = window.electronAPI?.getHotkey
    if (read) void read().then(setHotkey).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      const next = acceleratorFrom(event)
      if (!next) return
      setListening(false)
      void window.electronAPI?.setHotkey?.(next)?.then((ok) => {
        if (ok) {
          setHotkey(next)
          setProblem(null)
        } else {
          setProblem('O sistema não aceitou esse atalho.')
        }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listening])

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-elevated p-4 shadow-2xl ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Ajustes</h2>
          <button type="button" onClick={onClose} className="text-muted" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted">Atalho para abrir o compartilhamento de tela.</p>
        <button
          type="button"
          onClick={() => setListening(true)}
          className="mt-3 h-11 w-full rounded-lg bg-app text-sm font-semibold text-ink ring-1 ring-line"
        >
          {listening ? 'Pressione o atalho…' : hotkey}
        </button>
        {problem ? <p className="mt-2 text-sm text-danger">{problem}</p> : null}
        <p className="mt-3 text-xs text-muted">Ctrl+Shift+N continua abrindo outra janela.</p>
      </div>
    </div>
  )
}

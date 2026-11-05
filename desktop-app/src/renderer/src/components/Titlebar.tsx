import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Copy, Minus, Plus, RefreshCw, Square, Volume2, X } from 'lucide-react'
import logo from '@renderer/assets/logo.png'
import { Avatar } from '@renderer/components/Avatar'
import { requestSettings } from '@renderer/lib/settings-bus'
import type { RoomCard } from '@renderer/types'
import { DownloadApkButton } from '@renderer/components/ApkRelease'
import { hasUpdater, hasWindowControls, useMobileLayout } from '@renderer/lib/platform'
import { UpdateDialog, type UpdateStatus } from '@renderer/components/UpdateDialog'

interface TitlebarProps {
  roomId?: string
  displayName?: string
  avatar?: string
  accent?: string
  peerId?: string
  rooms?: RoomCard[]
  onSwitchRoom?: (roomId: string) => void
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const read = window.electronAPI?.isMaximized
    if (read) void read().then(setMaximized).catch(() => undefined)
    return window.electronAPI?.onMaximized?.(setMaximized)
  }, [])

  if (!hasWindowControls()) return null

  return (
    <div className="no-drag flex h-full shrink-0">
      <button
        type="button"
        aria-label="Minimizar"
        onClick={() => void window.electronAPI?.minimize?.()}
        className="flex h-full w-12 items-center justify-center text-muted hover:bg-white/10 hover:text-ink"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        onClick={() => void window.electronAPI?.toggleMaximize?.().then(setMaximized)}
        className="flex h-full w-12 items-center justify-center text-muted hover:bg-white/10 hover:text-ink"
      >
        {maximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Fechar"
        onClick={() => void window.electronAPI?.closeWindow?.()}
        className="flex h-full w-12 items-center justify-center text-muted hover:bg-[#ed4245] hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/

export function Titlebar({ roomId, displayName, avatar, accent, peerId, rooms = [], onSwitchRoom }: TitlebarProps) {
  const mobile = useMobileLayout()
  const [roomsOpen, setRoomsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draftRoom, setDraftRoom] = useState('')
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const roomButtonRef = useRef<HTMLButtonElement>(null)
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  const pending = update?.phase === 'available' || update?.phase === 'downloading' || update?.phase === 'ready'

  useEffect(() => {
    const api = window.electronAPI
    const readVersion = api?.getVersion
    if (readVersion) void readVersion().then(setVersion).catch(() => undefined)
    const stopStatus = api?.onUpdateStatus?.((status) => {
      if (status.phase === 'checking' || status.phase === 'error') setUpdate(status)
    })
    const stopAvailable = api?.onUpdateAvailable?.((info) => {
      setUpdate({ phase: 'available', version: info.version, notes: info.notes, current: info.current })
    })
    const stopCurrent = api?.onUpdateNotAvailable?.((info) => {
      setUpdate({ phase: 'current', current: info.current })
    })
    const stopProgress = api?.onDownloadProgress?.((progress) => {
      setUpdate((current) => ({
        phase: 'downloading',
        percent: progress.percent,
        version: current?.version,
        notes: current?.notes,
        current: current?.current,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total
      }))
    })
    const stopReady = api?.onUpdateDownloaded?.((info) => {
      setUpdate((current) => ({
        phase: 'ready',
        version: info.version || current?.version,
        notes: current?.notes,
        current: current?.current
      }))
    })
    return () => {
      stopStatus?.()
      stopAvailable?.()
      stopCurrent?.()
      stopProgress?.()
      stopReady?.()
    }
  }, [])

  useEffect(() => {
    if (!roomsOpen) return
    const close = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (roomButtonRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-room-menu]')) return
      setRoomsOpen(false)
      setCreating(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setRoomsOpen(false)
        setCreating(false)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [roomsOpen])

  function openRooms(): void {
    const rect = roomButtonRef.current?.getBoundingClientRect()
    if (rect) setMenuPos({ top: rect.bottom + 6, left: rect.left })
    setRoomsOpen((open) => !open)
    setCreating(false)
  }

  function createRoom(): void {
    const next = draftRoom.trim()
    if (!ROOM_RE.test(next)) return
    setRoomsOpen(false)
    setCreating(false)
    setDraftRoom('')
    onSwitchRoom?.(next)
  }

  if (mobile) return null

  const menu = roomsOpen
    ? createPortal(
        <div
          data-room-menu
          className="fixed z-[9999] w-80 rounded-xl bg-[#111214] p-2 text-ink shadow-2xl ring-1 ring-white/10"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {(rooms.length > 0 ? rooms : [{ roomId: roomId ?? 'sala', label: roomId ?? 'sala', members: [], activity: { screens: [], cameras: 0 } }]).map((room) => {
              const current = room.roomId === roomId
              const live = room.activity.screens[0]?.sourceName
              return (
                <button
                  key={room.roomId}
                  type="button"
                  onClick={() => {
                    setRoomsOpen(false)
                    if (!current) onSwitchRoom?.(room.roomId)
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left ${current ? 'bg-white/10' : 'hover:bg-white/10'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{room.label}</span>
                      <span className="text-xs text-muted">{room.members.length}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      {room.members.slice(0, 6).map((member) => (
                        <span key={member.peerId} className="inline-flex items-center gap-1 rounded-full bg-white/5 pr-2" title={member.name}>
                          <Avatar name={member.name} src={member.avatar} accent={member.accentColor} speaking={member.isSpeaking} size="xs" />
                          <span className="max-w-16 truncate text-[11px] text-ink">{member.name}</span>
                        </span>
                      ))}
                      {room.members.length === 0 ? <span className="text-xs text-muted">Vazia</span> : null}
                    </span>
                    {live ? <span className="mt-1 block text-[11px] font-semibold text-live">AO VIVO · {live}</span> : null}
                  </span>
                </button>
              )
            })}
          </div>
          {creating ? (
            <form
              className="mt-2 flex gap-2 border-t border-white/10 pt-2"
              onSubmit={(event) => {
                event.preventDefault()
                createRoom()
              }}
            >
              <input
                value={draftRoom}
                onChange={(event) => setDraftRoom(event.target.value)}
                placeholder="id-da-sala"
                maxLength={64}
                autoFocus
                className="h-9 min-w-0 flex-1 rounded-lg bg-white/5 px-2 text-sm text-ink ring-1 ring-white/10"
              />
              <button type="submit" className="h-9 rounded-lg bg-blurple px-3 text-sm font-semibold text-white">
                Criar
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-ink hover:bg-white/10"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Criar nova sala
            </button>
          )}
        </div>,
        document.body
      )
    : null

  return (
    <>
    <header className="titlebar-drag flex h-12 shrink-0 items-center border-b border-line bg-elevated">
      <div className="flex min-w-0 flex-1 items-center gap-3 pl-3">
        <img src={logo} alt="" className="h-6 w-6" />
        <span className="text-sm font-semibold text-ink">Concord</span>
        {roomId ? (
          <span className="no-drag relative">
            <button
              ref={roomButtonRef}
              type="button"
              onClick={openRooms}
              className="no-drag inline-flex max-w-64 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-ink hover:bg-white/10"
            >
              <Volume2 className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="truncate">{rooms.find((room) => room.roomId === roomId)?.label ?? roomId}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </div>
      <div className="no-drag flex h-full items-center gap-3 pr-2 text-sm text-muted">
        {version ? <span>v{version}</span> : null}
        <DownloadApkButton />
        {hasUpdater() ? (
          <button
            type="button"
            onClick={() => {
              setUpdateOpen(true)
              if (!pending) void window.electronAPI?.checkForUpdates?.()
            }}
            title={pending ? 'Há uma atualização do Concord' : 'Procurar uma nova versão do Concord'}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-200 active:scale-95 ${
              pending
                ? 'border-live/60 bg-live/15 text-ink hover:bg-live/25'
                : 'border-white/10 bg-white/5 text-muted hover:border-white/20 hover:bg-white/10 hover:text-ink'
            }`}
          >
            {pending ? (
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
              </span>
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {update?.phase === 'ready' ? 'Reiniciar para atualizar' : update?.phase === 'downloading' ? 'Baixando…' : pending ? 'Atualização disponível' : 'Verificar atualizações'}
          </button>
        ) : null}
        {updateOpen ? <UpdateDialog status={update} onClose={() => setUpdateOpen(false)} /> : null}
        {displayName ? (
          <button
            type="button"
            onClick={() => requestSettings('profile')}
            className="inline-flex max-w-44 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-ink hover:bg-white/10"
          >
            <Avatar name={displayName} src={avatar} accent={accent} peerId={peerId} size="xs" />
            <span className="truncate">{displayName}</span>
          </button>
        ) : null}
      </div>
      <WindowControls />
    </header>
    {menu}
    </>
  )
}

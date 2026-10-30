import { useEffect, useRef, useState } from 'react'
import { Columns2, LayoutGrid, PanelRight, PanelRightClose, PictureInPicture, WandSparkles } from 'lucide-react'
import { ControlBar } from '@renderer/components/ControlBar'
import { MemberList } from '@renderer/components/MemberList'
import { SettingsSheet } from '@renderer/components/SettingsSheet'
import { SourcePickerModal } from '@renderer/components/SourcePickerModal'
import { Stage, type StageHandle } from '@renderer/components/Stage'
import { type StageEntry } from '@renderer/components/StreamCard'
import { WebcamSheet } from '@renderer/components/WebcamSheet'
import type { RoomController } from '@renderer/hooks/useRoom'
import type { CaptureSettings, WebcamSettings } from '@renderer/types'

export function Room({ room }: { room: RoomController }) {
  const [picker, setPicker] = useState<'start' | 'swap' | null>(null)
  const [webcamOpen, setWebcamOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [layout, setLayout] = useState<'grid' | 'focus'>('grid')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const stageRef = useRef<StageHandle>(null)
  const entries: StageEntry[] = []

  if (room.self) {
    for (const local of room.locals) {
      entries.push({
        id: local.streamId,
        peerId: room.self.peerId,
        name: room.self.displayName,
        isSelf: true,
        meta: local.meta,
        media: local.media,
        watching: true,
        pc: local.pc,
        direction: 'outbound',
        watchers: local.watchers
      })
    }
    for (const peer of room.peers) {
      for (const stream of peer.streams) {
        if (!stream.watching) continue
        entries.push({
          id: stream.streamId,
          peerId: peer.peerId,
          name: peer.displayName,
          isSelf: false,
          meta: stream.meta,
          media: stream.media,
          watching: true,
          pc: stream.pc,
          direction: 'inbound',
          watchers: stream.watchers
        })
      }
    }
  }

  useEffect(() => {
    const stopOpen = window.electronAPI?.onOpenShare?.(() => setPicker(room.screenLive ? 'swap' : 'start'))
    const stopStart = window.electronAPI?.onQuickShareStart?.((settings) => {
      void room.publish(settings)
    })
    const stopShare = window.electronAPI?.onQuickShareStop?.(() => room.stopShare('screen'))
    return () => {
      stopOpen?.()
      stopStart?.()
      stopShare?.()
    }
  }, [room.screenLive, room.publish, room.stopShare])

  function confirm(settings: CaptureSettings): void {
    setPicker(null)
    void room.publish(settings)
  }

  function confirmWebcam(settings: WebcamSettings): void {
    setWebcamOpen(false)
    void room.publishWebcam(settings)
  }

  return (
    <div className="relative flex h-full flex-col bg-app text-ink">
      {room.audioWarning ? (
        <p className="bg-warn/15 px-4 py-2 text-sm text-warn" role="status">
          {room.audioWarning}
        </p>
      ) : null}
      {room.isolateAudio ? (
        <p className="bg-blurple/15 px-4 py-2 text-sm text-ink" role="status">
          As outras transmissões estão mudas enquanto o áudio do sistema está no ar, para a voz delas não voltar na captura.
        </p>
      ) : null}
      {room.error ? (
        <div className="flex items-center justify-between gap-3 bg-danger/15 px-4 py-2 text-sm text-danger" role="alert">
          <span>{room.error}</span>
          <button type="button" onClick={room.dismissError} className="font-semibold">
            Fechar
          </button>
        </div>
      ) : null}
      <div className="room-chrome flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <div className="flex gap-1 rounded-lg bg-panel p-0.5 ring-1 ring-white/10">
          <button
            type="button"
            onClick={() => setLayout('grid')}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs ${layout === 'grid' ? 'bg-blurple text-white' : 'text-muted'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Grade
          </button>
          <button
            type="button"
            onClick={() => setLayout('focus')}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs ${layout === 'focus' ? 'bg-blurple text-white' : 'text-muted'}`}
          >
            <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
            Foco
          </button>
        </div>
        <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={entries.length === 0}
          onClick={() => {
            setLayout('grid')
            stageRef.current?.organize('grid')
          }}
          title="Organizar grade"
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted transition-all duration-200 ease-out hover:bg-panel hover:text-ink active:scale-95 disabled:opacity-40"
        >
          <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Organizar
        </button>
        {entries.some((entry) => entry.meta.streamType === 'screen') &&
        entries.some((entry) => entry.meta.streamType === 'webcam') ? (
          <button
            type="button"
            onClick={() => {
              setLayout('grid')
              stageRef.current?.organize('corner')
            }}
            title="Tela grande + webcam no canto"
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted transition-all duration-200 ease-out hover:bg-panel hover:text-ink active:scale-95"
          >
            <PictureInPicture className="h-3.5 w-3.5" aria-hidden="true" />
            Canto
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Recolher a lista da sala' : 'Mostrar a lista da sala'}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted transition-all duration-200 ease-out hover:bg-panel hover:text-ink active:scale-95"
        >
          {sidebarOpen ? <PanelRightClose className="h-4 w-4" aria-hidden="true" /> : <PanelRight className="h-4 w-4" aria-hidden="true" />}
          {sidebarOpen ? 'Recolher' : 'Na sala'}
        </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="absolute inset-0">
              <Stage
                ref={stageRef}
                entries={entries}
                layout={layout}
                isolateAudio={room.isolateAudio}
                audioRoute={room.audioRoute}
                onWatch={room.watch}
                onUnwatch={room.unwatch}
                onLayoutChange={setLayout}
              />
            </div>
          </div>
          <div className="room-chrome">
          <ControlBar
            sharing={room.screenLive}
            webcamLive={room.webcamLive}
            busy={room.busy}
            onShare={() => setPicker('start')}
            onSwap={() => setPicker('swap')}
            onStop={() => room.stopShare('screen')}
            onWebcam={() => (room.webcamLive ? room.stopShare('webcam') : setWebcamOpen(true))}
            onSettings={() => setSettingsOpen(true)}
            onLeave={room.leave}
          />
          </div>
        </main>
        {sidebarOpen && room.self ? (
          <div className="room-chrome contents">
          <MemberList
            selfName={room.self.displayName}
            selfId={room.self.peerId}
            locals={room.locals}
            peers={room.peers}
            onWatch={room.watch}
            onUnwatch={room.unwatch}
          />
          </div>
        ) : null}
      </div>
      {picker ? <SourcePickerModal mode={picker} onClose={() => setPicker(null)} onConfirm={confirm} /> : null}
      {webcamOpen ? <WebcamSheet onClose={() => setWebcamOpen(false)} onConfirm={confirmWebcam} /> : null}
      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  )
}

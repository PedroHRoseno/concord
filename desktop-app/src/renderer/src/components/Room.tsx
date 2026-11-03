import { useEffect, useRef, useState } from 'react'
import { Columns2, LayoutGrid, PanelBottom, PanelLeft, PanelRight, PanelRightClose, PictureInPicture, WandSparkles } from 'lucide-react'
import { ChatPanel } from '@renderer/components/ChatPanel'
import { ControlBar } from '@renderer/components/ControlBar'
import { MemberList } from '@renderer/components/MemberList'
import { SettingsSheet, type SettingsSection } from '@renderer/components/SettingsSheet'
import { SourcePickerModal } from '@renderer/components/SourcePickerModal'
import { Stage, type CameraRail, type StageHandle } from '@renderer/components/Stage'
import { type StageEntry } from '@renderer/components/StreamCard'
import { WebcamSheet } from '@renderer/components/WebcamSheet'
import { useChat } from '@renderer/hooks/useChat'
import { IDLE_MS, useWindowActivity } from '@renderer/hooks/useIdle'
import type { RoomController } from '@renderer/hooks/useRoom'
import { canShareScreen, isMobile, useMobileLayout, useWakeLock } from '@renderer/lib/platform'
import { clampVolume } from '@renderer/lib/playback'
import type { CaptureSettings, ConnectionStatus, WebcamSettings } from '@renderer/types'

const CAMERA_RAIL_KEY = 'screenshare.focus.cameras'

function readCameraRail(): CameraRail {
  try {
    const stored = localStorage.getItem(CAMERA_RAIL_KEY)
    if (stored === 'left' || stored === 'right' || stored === 'bottom') return stored
  } catch {
    /* o padrão embaixo continua valendo */
  }
  return 'bottom'
}

function writeCameraRail(value: CameraRail): void {
  try {
    localStorage.setItem(CAMERA_RAIL_KEY, value)
  } catch {
    /* a escolha vale nesta sessão */
  }
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Conectando',
  connected: 'Conectado',
  reconnecting: 'Reconectando',
  disconnected: 'Desconectado'
}

export function Room({ room }: { room: RoomController }) {
  const [picker, setPicker] = useState<'start' | 'swap' | null>(null)
  const [webcamOpen, setWebcamOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('voice')
  const [layout, setLayout] = useState<'grid' | 'focus'>('grid')
  const [cameraRail, setCameraRail] = useState<CameraRail>(() => readCameraRail())
  const [sidebarOpen, setSidebarOpen] = useState(() => !isMobile())
  const [sideTab, setSideTab] = useState<'room' | 'chat'>('room')
  const [mixes, setMixes] = useState<Record<string, { volume: number; muted: boolean }>>({})
  const mobile = useMobileLayout()
  const facing = useRef<'user' | 'environment'>('user')
  useWakeLock(true)
  const unreadChat = useChat(room.chatMessages, room.self?.peerId ?? '', sidebarOpen && sideTab === 'chat')

  useEffect(() => {
    if (mobile) setSidebarOpen(false)
  }, [mobile])
  const stageRef = useRef<StageHandle>(null)
  const entries: StageEntry[] = []

  if (room.self) {
    for (const local of room.locals) {
      entries.push({
        id: local.streamId,
        peerId: room.self.peerId,
        name: room.profile.displayName || room.self.displayName,
        isSelf: true,
        avatarDataUrl: room.profile.avatarDataUrl,
        accentColor: room.profile.accentColor,
        customStatus: room.profile.customStatus,
        meta: local.meta,
        media: local.media,
        watching: true,
        pc: local.pc,
        direction: 'outbound',
        watchers: local.watchers,
        reconnecting: local.reconnecting
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
          avatarDataUrl: peer.profile.avatarDataUrl,
          accentColor: peer.profile.accentColor,
          customStatus: peer.profile.customStatus,
          meta: stream.meta,
          media: stream.media,
          watching: true,
          pc: stream.pc,
          direction: 'inbound',
          watchers: stream.watchers,
          reconnecting: stream.reconnecting
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

  const modalOpen = picker !== null || webcamOpen || settingsOpen
  // Só opacidade e pointer-events mudam: o espaço da dock se mantém, então o palco não é redimensionado.
  const dockVisible = useWindowActivity(IDLE_MS, !mobile && entries.length > 0 && !modalOpen)

  function openSettings(section: SettingsSection): void {
    setSettingsSection(section)
    setSettingsOpen(true)
  }

  function updateMix(id: string, patch: { volume?: number; muted?: boolean }): void {
    setMixes((current) => {
      const previous = current[id] ?? { volume: 1, muted: false }
      const next = { ...previous, ...patch }
      if (patch.volume !== undefined) next.volume = clampVolume(patch.volume)
      return { ...current, [id]: next }
    })
  }

  const peopleCount = room.self ? room.peers.length + 1 : room.peers.length
  const hasScreen = entries.some((entry) => entry.meta.streamType === 'screen')
  const hasWebcam = entries.some((entry) => entry.meta.streamType === 'webcam')
  const chat = room.self ? (
    <ChatPanel
      messages={room.chatMessages}
      selfId={room.self.peerId}
      selfName={room.profile.displayName || room.self.displayName}
      selfProfile={room.profile}
      peers={room.peers}
      signalingUrl={room.signalingUrl}
      connected={room.status === 'connected'}
      onSend={room.sendChat}
    />
  ) : null

  function confirm(settings: CaptureSettings): void {
    setPicker(null)
    void room.publish(settings)
  }

  function confirmWebcam(settings: WebcamSettings): void {
    setWebcamOpen(false)
    if (settings.facingMode) facing.current = settings.facingMode
    void room.publishWebcam(settings)
  }

  function flipCamera(): void {
    const next = facing.current === 'user' ? 'environment' : 'user'
    facing.current = next
    void room.publishWebcam({
      deviceId: '',
      deviceLabel: next === 'environment' ? 'Câmera traseira' : 'Câmera frontal',
      resolution: '720p',
      facingMode: next
    })
  }

  return (
    <div className="relative flex h-full flex-col bg-app text-ink">
      {mobile && room.status !== 'connected' ? (
        <p className="bg-warn/15 px-4 py-2 text-sm text-ink" role="status">
          {STATUS_LABEL[room.status]}
        </p>
      ) : null}
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
      <div className={`room-chrome flex shrink-0 items-center gap-2 border-b border-line px-3 ${mobile ? 'min-h-12 py-1' : 'h-9'}`}>
        <div className="flex gap-0.5 rounded-lg bg-panel p-0.5 ring-1 ring-white/10">
          <button
            type="button"
            onClick={() => setLayout('grid')}
            className={`inline-flex items-center gap-1 rounded-md px-2 text-xs ${mobile ? 'h-11' : 'h-7'} ${layout === 'grid' ? 'bg-blurple text-white' : 'text-muted'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Grade
          </button>
          <button
            type="button"
            onClick={() => setLayout('focus')}
            className={`inline-flex items-center gap-1 rounded-md px-2 text-xs ${mobile ? 'h-11' : 'h-7'} ${layout === 'focus' ? 'bg-blurple text-white' : 'text-muted'}`}
          >
            <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
            Foco
          </button>
        </div>
        {mobile ? <div className="min-w-0 flex-1" /> : (
          <>
            <span className="h-4 w-px bg-white/10" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {layout === 'grid' ? (
                <>
                  <button
                    type="button"
                    disabled={entries.length === 0}
                    onClick={() => stageRef.current?.organize('grid')}
                    title="Auto-organizar"
                    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-panel hover:text-ink disabled:opacity-40"
                  >
                    <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    Auto-organizar
                  </button>
                  <button
                    type="button"
                    disabled={entries.length === 0}
                    onClick={() => stageRef.current?.organize('grid')}
                    title="Lado a Lado"
                    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-panel hover:text-ink disabled:opacity-40"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                    Lado a Lado
                  </button>
                  <button
                    type="button"
                    disabled={!hasScreen || !hasWebcam}
                    onClick={() => stageRef.current?.organize('corner')}
                    title="Destaque + Canto"
                    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-panel hover:text-ink disabled:opacity-40"
                  >
                    <PictureInPicture className="h-3.5 w-3.5" aria-hidden="true" />
                    Destaque + Canto
                  </button>
                </>
              ) : (
                (
                  [
                    ['bottom', PanelBottom, 'Câmeras Embaixo'],
                    ['left', PanelLeft, 'Câmeras à Esquerda'],
                    ['right', PanelRight, 'Câmeras à Direita']
                  ] as const
                ).map(([id, Icon, label]) => (
                  <button
                    key={id}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={cameraRail === id}
                    onClick={() => {
                      setCameraRail(id)
                      writeCameraRail(id)
                    }}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${cameraRail === id ? 'bg-blurple text-white' : 'text-muted hover:text-ink'}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ))
              )}
            </div>
          </>
        )}
        <button
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Recolher a lista da sala' : 'Mostrar a lista da sala'}
          className={`relative inline-flex items-center gap-1.5 rounded-lg px-2 text-xs text-muted hover:bg-panel hover:text-ink ${mobile ? 'h-11' : 'h-8'}`}
        >
          {sidebarOpen ? <PanelRightClose className="h-4 w-4" aria-hidden="true" /> : <PanelRight className="h-4 w-4" aria-hidden="true" />}
          <span>{peopleCount}</span>
          {unreadChat > 0 ? (
            <span className="min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white">{unreadChat > 99 ? '99+' : unreadChat}</span>
          ) : null}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className="absolute inset-0">
              <Stage
                ref={stageRef}
                entries={entries}
                layout={layout}
                cameraRail={cameraRail}
                isolateAudio={room.isolateAudio}
                audioRoute={room.audioRoute}
                mixes={mixes}
                onMix={updateMix}
                onWatch={room.watch}
                onUnwatch={room.unwatch}
                onLayoutChange={setLayout}
              />
            </div>
          </div>
          <div
            className={`room-chrome transition-opacity duration-300 ${dockVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            aria-hidden={!dockVisible}
          >
          <ControlBar
            sharing={room.screenLive}
            webcamLive={room.webcamLive}
            micOn={room.micOn}
            deafened={room.deafened}
            onToggleMic={() => void room.toggleMic()}
            onToggleDeafen={room.toggleDeafen}
            onToggleSuppressor={(mode) => void room.applySuppressor(mode)}
            busy={room.busy}
            onShare={() => setPicker('start')}
            onSwap={() => setPicker('swap')}
            onStop={() => room.stopShare('screen')}
            onWebcam={() => (room.webcamLive ? room.stopShare('webcam') : setWebcamOpen(true))}
            onFlipCamera={flipCamera}
            onSettings={() => openSettings(settingsSection)}
            onLeave={room.leave}
          />
          </div>
        </main>
        {sidebarOpen && room.self ? (
          mobile ? (
            <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={() => setSidebarOpen(false)}>
              <div className="flex max-h-[78vh] w-full" onClick={(event) => event.stopPropagation()}>
                <MemberList
                  sheet
                  selfName={room.profile.displayName || room.self.displayName}
                  selfId={room.self.peerId}
                  selfProfile={room.profile}
                  locals={room.locals}
                  peers={room.peers}
                  onWatch={room.watch}
                  onUnwatch={room.unwatch}
                  onEditSelf={() => openSettings('profile')}
                  liveVolume={(streamId) => mixes[streamId]?.volume ?? 1}
                  onLiveVolume={(streamId, volume) => updateMix(streamId, { volume })}
                  tab={sideTab}
                  onTab={setSideTab}
                  unread={unreadChat}
                  chat={chat}
                />
              </div>
            </div>
          ) : (
          <div className="room-chrome contents">
          <MemberList
            selfName={room.profile.displayName || room.self.displayName}
            selfId={room.self.peerId}
            selfProfile={room.profile}
            locals={room.locals}
            peers={room.peers}
            onWatch={room.watch}
            onUnwatch={room.unwatch}
            onEditSelf={() => openSettings('profile')}
            liveVolume={(streamId) => mixes[streamId]?.volume ?? 1}
            onLiveVolume={(streamId, volume) => updateMix(streamId, { volume })}
            tab={sideTab}
            onTab={setSideTab}
            unread={unreadChat}
            chat={chat}
          />
          </div>
          )
        ) : null}
      </div>
      {picker && canShareScreen() ? <SourcePickerModal mode={picker} onClose={() => setPicker(null)} onConfirm={confirm} /> : null}
      {webcamOpen ? <WebcamSheet onClose={() => setWebcamOpen(false)} onConfirm={confirmWebcam} /> : null}
      {settingsOpen ? (
        <SettingsSheet
          initialSection={settingsSection}
          profile={room.profile}
          voiceLive={room.voiceLive}
          onApplyVoice={(mode) => void room.applySuppressor(mode)}
          onSaveProfile={room.updateProfile}
          onSection={setSettingsSection}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  )
}

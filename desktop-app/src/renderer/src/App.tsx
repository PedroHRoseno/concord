import { useEffect } from 'react'
import logo from '@renderer/assets/logo.png'
import { AndroidUpdateNotice } from '@renderer/components/ApkRelease'
import { Lobby } from '@renderer/components/Lobby'
import { QuickShare } from '@renderer/components/QuickShare'
import { Room } from '@renderer/components/Room'
import { Titlebar } from '@renderer/components/Titlebar'
import { useRoom } from '@renderer/hooks/useRoom'
import { readDiscordClientId } from '@renderer/lib/playback'
import { canShareScreen } from '@renderer/lib/platform'

const pickerOnly = new URLSearchParams(window.location.search).get('view') === 'picker'

export default function App() {
  if (pickerOnly) return canShareScreen() ? <QuickShare /> : null
  return <MainApp />
}

function MainApp() {
  const room = useRoom()

  useEffect(() => {
    const report = window.electronAPI?.setRoomState
    if (report) void report({ inRoom: room.phase === 'room', sharing: room.screenLive })
  }, [room.phase, room.screenLive])

  useEffect(() => {
    void window.electronAPI?.setDiscordClient?.(readDiscordClientId())
  }, [])

  useEffect(() => {
    const publication =
      room.phase === 'room'
        ? (room.locals.find((item) => item.meta.streamType === 'screen') ??
          room.locals.find((item) => item.meta.streamType === 'webcam'))
        : undefined
    void window.electronAPI?.setDiscordPresence?.({
      inRoom: room.phase === 'room',
      roomName: room.phase === 'room' ? (room.self?.roomId ?? '') : '',
      sharing: Boolean(publication),
      sourceName: publication?.meta.sourceName ?? ''
    })
  }, [room.phase, room.self, room.locals])

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <AndroidUpdateNotice />
      <Titlebar
        status={room.phase === 'room' ? room.status : undefined}
        roomId={room.phase === 'room' ? room.self?.roomId : undefined}
        displayName={room.phase === 'room' ? room.self?.displayName : undefined}
        avatar={room.phase === 'room' ? room.profile.avatarDataUrl : undefined}
        accent={room.phase === 'room' ? room.profile.accentColor : undefined}
        peerId={room.phase === 'room' ? room.self?.peerId : undefined}
        rooms={room.phase === 'room' ? room.rooms : undefined}
        onSwitchRoom={room.switchRoom}
      />
      <div className="min-h-0 flex-1">
        {room.phase === 'room' && room.status === 'connecting' ? (
          <div className="flex h-full items-center justify-center bg-app">
            <img src={logo} alt="" className="h-16 w-16 animate-pulse" />
          </div>
        ) : room.phase === 'lobby' ? (
          <Lobby error={room.error} onJoin={room.join} onDismissError={room.dismissError} />
        ) : (
          <Room room={room} />
        )}
      </div>
    </div>
  )
}

import { useEffect } from 'react'
import { Lobby } from '@renderer/components/Lobby'
import { QuickShare } from '@renderer/components/QuickShare'
import { Room } from '@renderer/components/Room'
import { Titlebar } from '@renderer/components/Titlebar'
import { useRoom } from '@renderer/hooks/useRoom'

const pickerOnly = new URLSearchParams(window.location.search).get('view') === 'picker'

export default function App() {
  if (pickerOnly) return <QuickShare />
  return <MainApp />
}

function MainApp() {
  const room = useRoom()

  useEffect(() => {
    const report = window.electronAPI?.setRoomState
    if (report) void report({ inRoom: room.phase === 'room', sharing: room.screenLive })
  }, [room.phase, room.screenLive])

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <Titlebar
        status={room.phase === 'room' ? room.status : undefined}
        roomId={room.phase === 'room' ? room.self?.roomId : undefined}
        displayName={room.phase === 'room' ? room.self?.displayName : undefined}
        peerCount={room.phase === 'room' ? room.peers.length + 1 : undefined}
      />
      <div className="min-h-0 flex-1">
        {room.phase === 'lobby' ? (
          <Lobby error={room.error} onJoin={room.join} onDismissError={room.dismissError} />
        ) : (
          <Room room={room} />
        )}
      </div>
    </div>
  )
}

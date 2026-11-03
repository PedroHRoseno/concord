import { useEffect, useState } from 'react'
import { SignalingClient } from '@renderer/lib/signaling'
import type { RoomCard } from '@renderer/types'

export function useRoomDirectory(url: string, enabled: boolean): RoomCard[] {
  const [rooms, setRooms] = useState<RoomCard[]>([])
  useEffect(() => {
    if (!enabled || !url) return
    const client = new SignalingClient(url)
    client.onOpen = () => client.send({ type: 'watch-rooms' })
    client.onMessage = (message) => {
      if (message.type === 'rooms' || message.type === 'rooms-updated') setRooms(message.rooms)
    }
    client.start()
    return () => client.stop()
  }, [url, enabled])
  return rooms
}

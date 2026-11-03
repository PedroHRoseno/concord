import { useEffect, useRef, useState } from 'react'
import { playChatSound } from '@renderer/utils/soundEffects'
import type { ChatMessage } from '@renderer/types'

/** Conta mensagens não lidas e toca o som quando chega algo e o chat não está à vista. */
export function useChat(messages: ChatMessage[], selfId: string, tabOpen: boolean): number {
  const [unread, setUnread] = useState(0)
  const seen = useRef<string | null>(null)
  const primed = useRef(false)

  useEffect(() => {
    const last = messages[messages.length - 1]?.id ?? null
    if (!primed.current) {
      // O histórico entregue ao entrar não conta como novo.
      primed.current = true
      seen.current = last
      return
    }
    if (last === seen.current) return
    const lastSeenIndex = seen.current ? messages.findIndex((item) => item.id === seen.current) : -1
    const fresh = messages.slice(lastSeenIndex + 1).filter((item) => item.peerId !== selfId && Date.now() - item.ts < 15_000)
    seen.current = last
    if (fresh.length === 0) return
    const visible = tabOpen && document.hasFocus()
    if (!visible) playChatSound()
    if (!tabOpen) setUnread((count) => count + fresh.length)
  }, [messages, selfId, tabOpen])

  useEffect(() => {
    if (tabOpen) setUnread(0)
  }, [tabOpen])

  return unread
}

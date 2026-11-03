import { Paperclip, Send } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { CHAT_TEXT_LIMIT, compressImage, openLink, readPreviews, splitLinks } from '@renderer/lib/chat'
import type { ChatMessage } from '@renderer/types'

interface ChatPanelProps {
  messages: ChatMessage[]
  selfId: string
  connected: boolean
  onSend: (text: string, image?: string) => void
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function MessageText({ text, previews }: { text: string; previews: boolean }) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm text-ink">
        {splitLinks(text).map((part, index) =>
          part.kind === 'text' ? (
            <span key={index}>{part.value}</span>
          ) : (
            <a
              key={index}
              href={part.value}
              onClick={(event) => {
                event.preventDefault()
                openLink(part.value)
              }}
              className="text-blurple underline"
            >
              {part.value}
            </a>
          )
        )}
      </p>
      {previews
        ? splitLinks(text).map((part, index) => {
            if (part.kind !== 'link' || !part.embed) return null
            return part.embed === 'image' ? (
              <img
                key={index}
                src={part.value}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="mt-1 max-h-60 max-w-full rounded-lg"
              />
            ) : (
              <video
                key={index}
                src={part.value}
                controls
                preload="none"
                className="mt-1 max-h-60 max-w-full rounded-lg"
              />
            )
          })
        : null}
    </>
  )
}

export function ChatPanel({ messages, selfId, connected, onSend }: ChatPanelProps) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const previews = readPreviews()
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

  async function sendImage(file: Blob): Promise<void> {
    setBusy(true)
    setProblem(null)
    try {
      const image = await compressImage(file)
      onSend('', image)
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Não foi possível enviar a imagem.')
    } finally {
      setBusy(false)
    }
  }

  function submit(event?: FormEvent): void {
    event?.preventDefault()
    const body = text.trim()
    if (!body || !connected) return
    onSend(body)
    setText('')
    setProblem(null)
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'))
    if (!file || !connected) return
    event.preventDefault()
    void sendImage(file)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-2">
        {messages.length === 0 ? <p className="px-1 py-4 text-xs text-muted">Nenhuma mensagem ainda.</p> : null}
        {messages.map((message) => (
          <div key={message.id}>
            <p className="flex items-baseline gap-2 text-xs">
              <span className={`font-semibold ${message.peerId === selfId ? 'text-blurple' : 'text-ink'}`}>{message.displayName}</span>
              <span className="text-muted">{clock(message.ts)}</span>
            </p>
            {message.text ? <MessageText text={message.text} previews={previews} /> : null}
            {message.image ? (
              <img src={message.image} alt="Imagem enviada no chat" className="mt-1 max-h-60 max-w-full rounded-lg" />
            ) : null}
          </div>
        ))}
      </div>
      {problem ? <p className="px-3 pb-1 text-xs text-danger">{problem}</p> : null}
      <form onSubmit={submit} className="flex items-end gap-1.5 border-t border-line p-2">
        <button
          type="button"
          disabled={!connected || busy}
          onClick={() => fileRef.current?.click()}
          title="Anexar imagem"
          aria-label="Anexar imagem"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-all hover:bg-app hover:text-ink disabled:opacity-40"
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void sendImage(file)
          }}
        />
        <textarea
          value={text}
          rows={1}
          maxLength={CHAT_TEXT_LIMIT}
          disabled={!connected}
          placeholder={connected ? 'Mensagem' : 'Sem conexão'}
          onChange={(event) => setText(event.target.value)}
          onPaste={paste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event)
          }}
          className="max-h-24 min-h-9 flex-1 resize-none rounded-lg bg-app px-3 py-2 text-sm text-ink ring-1 ring-line disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !text.trim()}
          title="Enviar"
          aria-label="Enviar"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blurple text-white transition-all active:scale-95 disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  )
}

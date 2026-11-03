import { Plus, Send, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from '@renderer/components/Avatar'
import {
  CHAT_TEXT_LIMIT,
  compressImage,
  fetchUnfurl,
  linkEmbed,
  openLink,
  readPreviews,
  splitLinks,
  youtubeId,
  type UnfurlCard
} from '@renderer/lib/chat'
import type { ChatMessage, PeerView, PublicProfile } from '@renderer/types'

interface ChatPanelProps {
  messages: ChatMessage[]
  selfId: string
  selfName: string
  selfProfile: PublicProfile
  peers: PeerView[]
  signalingUrl: string
  connected: boolean
  onSend: (text: string, image?: string) => void
  booting?: boolean
}

const GROUP_MS = 5 * 60 * 1000
const seenProfiles = new Map<string, PublicProfile>()

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function profileFor(peerId: string, selfId: string, selfProfile: PublicProfile, peers: PeerView[]): PublicProfile {
  if (peerId === selfId) {
    seenProfiles.set(peerId, selfProfile)
    return selfProfile
  }
  const peer = peers.find((item) => item.peerId === peerId)
  if (peer) {
    seenProfiles.set(peerId, peer.profile)
    return peer.profile
  }
  return seenProfiles.get(peerId) ?? { avatarDataUrl: '', accentColor: '#5865F2', customStatus: '' }
}

function continuation(messages: ChatMessage[], index: number): boolean {
  if (index <= 0) return false
  const current = messages[index]
  const previous = messages[index - 1]
  if (!current || !previous) return false
  return current.peerId === previous.peerId && current.ts >= previous.ts && current.ts - previous.ts < GROUP_MS
}

function openOriginal(src: string): void {
  if (src.startsWith('data:')) {
    window.open(src, '_blank', 'noopener,noreferrer')
    return
  }
  openLink(src)
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-6" onClick={onClose}>
      <img
        src={src}
        alt="Imagem ampliada"
        style={{ transform: `scale(${zoom})` }}
        className="max-h-[85vh] max-w-[90vw] object-contain transition-transform"
        onClick={(event) => event.stopPropagation()}
      />
      <div className="absolute bottom-6 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-white" aria-label="Aumentar zoom">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.25))} className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-white" aria-label="Diminuir zoom">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => openOriginal(src)} className="h-9 rounded-full bg-zinc-800 px-3 text-sm text-white">
          Abrir original
        </button>
      </div>
    </div>,
    document.body
  )
}

function accentBar(kind: string): string {
  if (kind === 'youtube') return '#ff0033'
  if (kind === 'twitch') return '#9146ff'
  return '#5865F2'
}

function LinkCard({ url, signalingUrl, onZoom }: { url: string; signalingUrl: string; onZoom: (src: string) => void }) {
  const embed = linkEmbed(url)
  const [card, setCard] = useState<UnfurlCard | null>(null)
  const videoId = youtubeId(url)

  useEffect(() => {
    if (!embed || embed === 'image' || embed === 'video' || !signalingUrl) return
    let cancel = false
    void fetchUnfurl(signalingUrl, url).then((found) => {
      if (!cancel) setCard(found)
    })
    return () => {
      cancel = true
    }
  }, [embed, signalingUrl, url])

  if (embed === 'image') {
    return (
      <button type="button" onClick={() => onZoom(url)} className="mt-1 block">
        <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-60 max-w-full rounded-lg" />
      </button>
    )
  }
  if (embed === 'video') {
    return <video src={url} controls preload="none" className="mt-1 max-h-60 max-w-full rounded-lg" />
  }
  if (!embed) return null
  const image = card?.image || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '')
  const title = card?.title || (embed === 'youtube' ? 'YouTube' : embed === 'twitch' ? 'Twitch' : safeHost(url))
  const site = card?.siteName || (embed === 'youtube' ? 'YouTube' : embed === 'twitch' ? 'Twitch' : safeHost(url))
  return (
    <div className="mt-1.5 flex max-w-sm overflow-hidden rounded-md bg-black/30 ring-1 ring-white/10">
      <span className="w-1 shrink-0" style={{ backgroundColor: accentBar(embed) }} />
      <div className="min-w-0 flex-1 p-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{site}</p>
        <button type="button" onClick={() => openLink(url)} className="mt-0.5 block max-w-full truncate text-left text-sm font-semibold text-[#00a8fc] hover:underline">
          {title}
        </button>
        {card?.description ? <p className="mt-1 line-clamp-3 text-xs text-muted">{card.description}</p> : null}
        {image ? (
          <button type="button" onClick={() => openLink(url)} className="mt-2 block overflow-hidden rounded-md">
            <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-44 w-full object-cover" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function MessageBody({ text, signalingUrl, onZoom }: { text: string; signalingUrl: string; onZoom: (src: string) => void }): ReactNode {
  const previews = readPreviews()
  const parts = splitLinks(text)
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm text-ink">
        {parts.map((part, index) =>
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
              className="text-[#00a8fc] hover:underline"
            >
              {part.value}
            </a>
          )
        )}
      </p>
      {previews
        ? parts.map((part, index) =>
            part.kind === 'link' && part.embed ? <LinkCard key={`${part.value}-${index}`} url={part.value} signalingUrl={signalingUrl} onZoom={onZoom} /> : null
          )
        : null}
    </>
  )
}

export function ChatPanel({ messages, selfId, selfName, selfProfile, peers, signalingUrl, connected, onSend, booting = false }: ChatPanelProps) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages.length])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    box.style.height = '0px'
    box.style.height = `${Math.min(box.scrollHeight, 120)}px`
  }, [text])

  async function stageImage(file: Blob): Promise<void> {
    setBusy(true)
    setProblem(null)
    try {
      setPending(await compressImage(file))
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Não foi possível preparar a imagem.')
    } finally {
      setBusy(false)
    }
  }

  function submit(event?: FormEvent): void {
    event?.preventDefault()
    const body = text.trim()
    if ((!body && !pending) || !connected || busy) return
    onSend(body, pending ?? undefined)
    setText('')
    setPending(null)
    setProblem(null)
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/'))
    if (!file || !connected) return
    event.preventDefault()
    void stageImage(file)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {booting ? (
          <div className="space-y-3 px-3 py-2">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex animate-pulse gap-2">
                <span className="h-10 w-10 rounded-full bg-white/10" />
                <span className="mt-2 h-3 flex-1 rounded bg-white/10" />
              </div>
            ))}
          </div>
        ) : (
          <div className="transition-opacity duration-300">
        {messages.length === 0 ? <p className="px-3 py-4 text-xs text-muted">Nenhuma mensagem ainda.</p> : null}
        {messages.map((message, index) => {
          const grouped = continuation(messages, index)
          const profile = profileFor(message.peerId, selfId, selfProfile, peers)
          const name = message.peerId === selfId ? selfName || message.displayName : message.displayName
          return (
            <div key={message.id} className={`group relative flex gap-2 rounded px-2 py-0.5 hover:bg-white/[0.04] ${grouped ? 'mt-px' : 'mt-3'}`}>
              <div className="w-10 shrink-0">
                {grouped ? (
                  <span className="block pt-0.5 text-right text-[10px] text-muted opacity-0 group-hover:opacity-100">{clock(message.ts)}</span>
                ) : (
                  <Avatar name={name} src={profile.avatarDataUrl} accent={profile.accentColor} peerId={message.peerId} size="md" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {grouped ? null : (
                  <p className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-semibold" style={{ color: profile.accentColor }}>
                      {name}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">{clock(message.ts)}</span>
                  </p>
                )}
                {message.text ? <MessageBody text={message.text} signalingUrl={signalingUrl} onZoom={setZoom} /> : null}
                {message.image ? (
                  <button type="button" onClick={() => setZoom(message.image ?? null)} className="mt-1 block">
                    <img src={message.image} alt="Imagem enviada no chat" className="max-h-60 max-w-full rounded-lg" />
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
          </div>
        )}
      </div>
      {problem ? <p className="px-3 pb-1 text-xs text-danger">{problem}</p> : null}
      <form onSubmit={submit} className="mx-2 mb-2 rounded-xl bg-zinc-800/90 p-2 ring-1 ring-white/10">
        {pending ? (
          <div className="relative mb-2 inline-block">
            <img src={pending} alt="Prévia da imagem" className="h-16 rounded-lg" />
            <button
              type="button"
              onClick={() => setPending(null)}
              aria-label="Remover imagem"
              className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white ring-1 ring-white/20"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            disabled={!connected || busy}
            onClick={() => fileRef.current?.click()}
            title="Anexar imagem"
            aria-label="Anexar imagem"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-zinc-100 transition-all hover:bg-zinc-600 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void stageImage(file)
            }}
          />
          <textarea
            ref={boxRef}
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
            className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-ink outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!connected || busy || (!text.trim() && !pending)}
            title="Enviar"
            aria-label="Enviar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-all hover:text-ink active:scale-95 disabled:opacity-40"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
      {zoom ? <Lightbox src={zoom} onClose={() => setZoom(null)} /> : null}
    </div>
  )
}

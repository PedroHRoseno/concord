import { useSpeaking } from '@renderer/lib/voice'

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

interface AvatarProps {
  name: string
  src?: string
  accent?: string
  live?: boolean
  size?: 'sm' | 'md'
  /** Quando informado, desenha o anel verde enquanto esse peer fala. */
  peerId?: string
}

export function Avatar({ name, src, accent = '#5865F2', live = false, size = 'md', peerId }: AvatarProps) {
  const speaking = useSpeaking(peerId ?? '')
  const color = COLOR_RE.test(accent) ? accent : '#5865F2'
  const initial = name.trim().slice(0, 1).toUpperCase() || '?'
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel text-xs font-semibold text-ink ${size === 'sm' ? 'h-7 w-7' : 'h-10 w-10'}`}
      style={speaking ? { boxShadow: '0 0 0 2px #23a559, 0 0 8px 1px rgba(35,165,89,0.6)' } : live ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initial}
    </span>
  )
}

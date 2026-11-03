import { useSpeaking } from '@renderer/lib/voice'

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

interface AvatarProps {
  name: string
  src?: string
  accent?: string
  live?: boolean
  size?: 'xs' | 'sm' | 'md'
  /** Quando informado, desenha o anel verde enquanto esse peer fala. */
  peerId?: string
  speaking?: boolean
}

export function Avatar({ name, src, accent = '#5865F2', live = false, size = 'md', peerId, speaking = false }: AvatarProps) {
  const heard = useSpeaking(peerId ?? '')
  const talking = speaking || heard
  const color = COLOR_RE.test(accent) ? accent : '#5865F2'
  const initial = name.trim().slice(0, 1).toUpperCase() || '?'
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel font-semibold text-ink ${talking ? 'ring-2 ring-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : ''} ${size === 'xs' ? 'h-5 w-5 text-[10px]' : size === 'sm' ? 'h-7 w-7 text-xs' : 'h-10 w-10 text-xs'}`}
      style={!talking && live ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initial}
    </span>
  )
}

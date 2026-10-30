import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Expand,
  LayoutGrid,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Volume2,
  VolumeX
} from 'lucide-react'
import { readStreamStats, type StreamStats } from '@renderer/lib/stats'
import { StatsOverlay } from '@renderer/components/StatsOverlay'

interface VideoStageProps {
  media: MediaStream
  isSelf: boolean
  peerId: string
  volume: number
  muted: boolean
  pc: RTCPeerConnection | null
  direction: 'inbound' | 'outbound'
  fill: boolean
  focused: boolean
  onVolume: (value: number) => void
  onMuted: (value: boolean) => void
  onFocus: () => void
  onExitFocus: () => void
}

export function VideoStage({
  media,
  isSelf,
  peerId,
  volume,
  muted,
  pc,
  direction,
  fill,
  focused,
  onVolume,
  onMuted,
  onFocus,
  onExitFocus
}: VideoStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const scaleRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [transform, setTransform] = useState('translate(0px, 0px) scale(1)')
  const [showStats, setShowStats] = useState(false)
  const [stats, setStats] = useState<StreamStats | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [pip, setPip] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = media
    void video.play().catch(() => undefined)
    return () => {
      video.pause()
      video.srcObject = null
    }
  }, [media])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = isSelf || muted
    video.volume = muted ? 0 : volume
  }, [isSelf, muted, volume, media])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const next = Math.min(6, Math.max(1, scaleRef.current * (event.deltaY < 0 ? 1.08 : 0.92)))
      scaleRef.current = next
      if (next === 1) panRef.current = { x: 0, y: 0 }
      setTransform(`translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${next})`)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnter = () => setPip(true)
    const onLeave = () => setPip(false)
    video.addEventListener('enterpictureinpicture', onEnter)
    video.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter)
      video.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [media])

  useEffect(() => {
    if (!showStats) return
    let cancelled = false
    const tick = async () => {
      if (pc) {
        const next = await readStreamStats(pc, direction, `${direction}:${peerId}`)
        if (!cancelled) setStats(next)
        return
      }
      const video = videoRef.current
      if (!video || cancelled) return
      setStats({
        width: video.videoWidth,
        height: video.videoHeight,
        fps: 0,
        bitrateMbps: 0,
        codec: '—',
        rttMs: null
      })
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [showStats, pc, direction, peerId])

  async function toggleFullscreen(): Promise<void> {
    const node = containerRef.current
    if (!node) return
    if (document.fullscreenElement === node) await document.exitFullscreen()
    else await node.requestFullscreen()
  }

  async function togglePip(): Promise<void> {
    const video = videoRef.current
    if (!video || !document.pictureInPictureEnabled) return
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture()
    else await video.requestPictureInPicture()
  }

  function resetZoom(): void {
    scaleRef.current = 1
    panRef.current = { x: 0, y: 0 }
    setTransform('translate(0px, 0px) scale(1)')
  }

  return (
    <div
      ref={containerRef}
      className={`group relative overflow-hidden bg-black ${fill ? 'h-full w-full rounded-xl' : 'aspect-video w-full'}`}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-hud]')) return
        resetZoom()
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('[data-hud]')) return
        dragRef.current = {
          x: event.clientX - panRef.current.x,
          y: event.clientY - panRef.current.y,
          moved: false
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag || scaleRef.current <= 1) return
        const x = event.clientX - drag.x
        const y = event.clientY - drag.y
        if (Math.hypot(x - panRef.current.x, y - panRef.current.y) > 3) drag.moved = true
        panRef.current = { x, y }
        setTransform(`translate(${x}px, ${y}px) scale(${scaleRef.current})`)
      }}
      onPointerUp={() => {
        const drag = dragRef.current
        dragRef.current = null
        if (drag && !drag.moved && scaleRef.current === 1) onFocus()
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="h-full w-full object-contain"
        style={{ transform, transformOrigin: 'center center' }}
      />
      {showStats ? <StatsOverlay stats={stats} pending={!stats} /> : null}
      <div
        data-hud
        className="absolute inset-x-2 bottom-2 z-20 flex items-center gap-2 rounded-xl bg-black/70 px-2 py-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      >
        <button
          type="button"
          aria-label={muted || isSelf ? 'Ativar som' : 'Silenciar'}
          disabled={isSelf}
          onClick={() => onMuted(!muted)}
          className="rounded-md p-1.5 text-ink hover:bg-white/10 disabled:opacity-40"
        >
          {muted || isSelf ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <input
          aria-label="Volume"
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          disabled={isSelf}
          onChange={(event) => {
            const next = Number(event.target.value) / 100
            onVolume(next)
            onMuted(next === 0)
          }}
          className="w-24 disabled:opacity-40"
        />
        <button
          type="button"
          aria-label={pip ? 'Sair do picture-in-picture' : 'Picture-in-picture'}
          onClick={() => void togglePip()}
          className="rounded-md p-1.5 text-ink hover:bg-white/10"
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          onClick={() => void toggleFullscreen()}
          className="rounded-md p-1.5 text-ink hover:bg-white/10"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          aria-label="Estatísticas"
          aria-pressed={showStats}
          onClick={() => setShowStats((value) => !value)}
          className={`rounded-md p-1.5 hover:bg-white/10 ${showStats ? 'text-blurple' : 'text-ink'}`}
        >
          <Activity className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={focused ? 'Voltar à grade' : 'Focar'}
          onClick={focused ? onExitFocus : onFocus}
          className="rounded-md p-1.5 text-ink hover:bg-white/10"
        >
          {focused ? <LayoutGrid className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Expand,
  EyeOff,
  LayoutGrid,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Volume2,
  VolumeX
} from 'lucide-react'
import { readStreamStats, type StreamStats } from '@renderer/lib/stats'
import { StatsOverlay } from '@renderer/components/StatsOverlay'

export interface StreamDetails {
  kind: string
  sourceName: string
  quality: string
  audio: string
}

interface VideoStageProps {
  media: MediaStream
  isSelf: boolean
  peerId: string
  volume: number
  muted: boolean
  pc: RTCPeerConnection | null
  direction: 'inbound' | 'outbound'
  focused: boolean
  chrome: boolean
  canvas: boolean
  details: StreamDetails | null
  onVolume: (value: number) => void
  onMuted: (value: boolean) => void
  onFocus: () => void
  onExitFocus: () => void
  onToggleWatch: (() => void) | null
}

function factLines(details: StreamDetails | null): Array<{ label: string; value: string }> {
  if (!details) return []
  return [
    { label: 'Tipo', value: details.kind },
    { label: 'Janela', value: details.sourceName },
    { label: 'Qualidade', value: details.quality },
    { label: 'Áudio', value: details.audio }
  ]
}

export function VideoStage({
  media,
  isSelf,
  peerId,
  volume,
  muted,
  pc,
  direction,
  focused,
  chrome,
  canvas,
  details,
  onVolume,
  onMuted,
  onFocus,
  onExitFocus,
  onToggleWatch
}: VideoStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const scaleRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [transform, setTransform] = useState('translate(0px, 0px) scale(1)')
  const [zoomed, setZoomed] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [stats, setStats] = useState<StreamStats | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [pip, setPip] = useState(false)
  const facts = factLines(details)

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
      setZoomed(next !== 1)
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
    setZoomed(false)
    setTransform('translate(0px, 0px) scale(1)')
  }

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-black ${canvas && !zoomed ? 'stage-drag cursor-grab' : ''} ${zoomed ? 'cursor-move' : ''}`}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-hud]')) return
        resetZoom()
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('[data-hud]')) return
        if (canvas && scaleRef.current <= 1) return
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
        if (canvas) return
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
      {showStats ? <StatsOverlay stats={stats} pending={!stats} facts={facts} /> : null}
      <div
        data-hud
        className={`stage-no-drag absolute inset-x-3 bottom-3 z-20 flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-xl border border-white/10 bg-zinc-950/85 px-3 py-1.5 shadow-lg backdrop-blur-md transition-opacity duration-200 ${chrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <button
          type="button"
          title={muted || isSelf ? 'Ativar som' : 'Silenciar'}
          aria-label={muted || isSelf ? 'Ativar som' : 'Silenciar'}
          disabled={isSelf}
          onClick={() => onMuted(!muted)}
          className="rounded-md p-1.5 text-ink hover:bg-white/10 disabled:opacity-40"
        >
          {muted || isSelf ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <input
          title="Volume"
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
          title={pip ? 'Sair do picture-in-picture' : 'Picture-in-picture'}
          aria-label={pip ? 'Sair do picture-in-picture' : 'Picture-in-picture'}
          onClick={() => void togglePip()}
          className="rounded-md p-1.5 text-ink hover:bg-white/10"
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          onClick={() => void toggleFullscreen()}
          className="rounded-md p-1.5 text-ink hover:bg-white/10"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <div className="relative" onMouseEnter={() => setInfoOpen(true)} onMouseLeave={() => setInfoOpen(false)}>
          <button
            type="button"
            title="Detalhes da transmissão"
            aria-label="Detalhes da transmissão"
            className="rounded-md px-1.5 py-1 text-[10px] font-bold tracking-wide text-ink hover:bg-white/10"
          >
            HD
          </button>
          {infoOpen && facts.length > 0 ? (
            <div className="absolute bottom-full left-0 z-30 mb-2 w-60 rounded-lg border border-white/10 bg-zinc-950/95 p-2 text-[11px] leading-4 text-ink shadow-lg backdrop-blur-md">
              {facts.map((fact) => (
                <p key={fact.label} className="flex justify-between gap-3">
                  <span className="text-muted">{fact.label}</span>
                  <span className="truncate text-right">{fact.value}</span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          title="Estatísticas e detalhes"
          aria-label="Estatísticas e detalhes"
          aria-pressed={showStats}
          onClick={() => setShowStats((value) => !value)}
          className={`rounded-md p-1.5 hover:bg-white/10 ${showStats ? 'text-blurple' : 'text-ink'}`}
        >
          <Activity className="h-4 w-4" />
        </button>
        {onToggleWatch ? (
          <button
            type="button"
            title="Parar de assistir"
            aria-label="Parar de assistir"
            onClick={onToggleWatch}
            className="rounded-md p-1.5 text-ink hover:bg-white/10"
          >
            <EyeOff className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          title={focused ? 'Voltar à grade' : 'Focar'}
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

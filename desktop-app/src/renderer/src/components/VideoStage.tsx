import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  Expand,
  EyeOff,
  LayoutGrid,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Video,
  VideoOff,
  Volume2,
  VolumeX
} from 'lucide-react'
import { readStreamStats, type StreamStats } from '@renderer/lib/stats'
import { StatsOverlay } from '@renderer/components/StatsOverlay'
import {
  applySink,
  clampVolume,
  openPlayback,
  readFloatingWebcams,
  readSinkId,
  subscribeFloatingWebcams,
  subscribeSink,
  writeFloatingWebcams,
  type PlaybackGraph
} from '@renderer/lib/playback'

export interface StreamDetails {
  kind: string
  sourceName: string
  quality: string
  audio: string
}

export type FloatMode = 'grid' | 'focus' | 'none'

export interface FloatCam {
  id: string
  name: string
  media: MediaStream
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
  floatMode: FloatMode
  webcams: FloatCam[]
  onVolume: (value: number) => void
  onMuted: (value: boolean) => void
  onFocus: () => void
  onExitFocus: () => void
  onToggleWatch: (() => void) | null
}

interface WebkitVideo extends HTMLVideoElement {
  webkitSupportsFullscreen?: boolean
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
  webkitDisplayingFullscreen?: boolean
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture') => void
  webkitPresentationMode?: string
}

function tileOf(node: HTMLElement): HTMLElement {
  return (node.closest('.stage-tile') as HTMLElement | null) ?? node
}

function inHud(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-hud]'))
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

function FloatingCam({ cam, origin }: { cam: FloatCam; origin: { x: number; y: number } }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [pos, setPos] = useState(origin)
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = cam.media
    void video.play().catch(() => undefined)
    return () => {
      video.pause()
      video.srcObject = null
    }
  }, [cam.media])

  function move(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = drag.current
    if (!current) return
    const parent = event.currentTarget.parentElement
    const maxX = Math.max(8, (parent?.clientWidth ?? 160) - 168)
    const maxY = Math.max(8, (parent?.clientHeight ?? 90) - 98)
    setPos({
      x: Math.min(maxX, Math.max(8, event.clientX - current.x)),
      y: Math.min(maxY, Math.max(8, event.clientY - current.y))
    })
  }

  return (
    <div
      data-hud
      className="stage-no-drag absolute z-20 w-40 cursor-grab overflow-hidden rounded-lg bg-black shadow-lg ring-1 ring-white/20 active:cursor-grabbing"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={(event) => {
        event.stopPropagation()
        drag.current = { x: event.clientX - pos.x, y: event.clientY - pos.y }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = null
      }}
    >
      <video ref={videoRef} autoPlay playsInline muted className="pointer-events-none aspect-video w-full object-cover" />
      <span className="pointer-events-none absolute bottom-1 left-1 max-w-[9rem] truncate rounded bg-black/70 px-1.5 text-[10px] text-white">
        {cam.name}
      </span>
    </div>
  )
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
  floatMode,
  webcams,
  onVolume,
  onMuted,
  onFocus,
  onExitFocus,
  onToggleWatch
}: VideoStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const graphRef = useRef<PlaybackGraph | null>(null)
  const scaleRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [transform, setTransform] = useState('translate(0px, 0px) scale(1)')
  const [zoomed, setZoomed] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [stats, setStats] = useState<StreamStats | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [lifted, setLifted] = useState(false)
  const [pip, setPip] = useState(false)
  const [infoPinned, setInfoPinned] = useState(false)
  const [floatsOn, setFloatsOn] = useState(readFloatingWebcams)
  const cssCleanup = useRef<(() => void) | null>(null)
  const nativeFullscreen = useRef(false)
  const facts = factLines(details)
  const infoVisible = infoOpen || infoPinned
  const gain = clampVolume(volume)
  const screenShare = details?.kind !== 'Webcam'
  const showFloats =
    floatsOn && screenShare && webcams.length > 0 && (floatMode === 'grid' || (floatMode === 'focus' && fullscreen))

  useEffect(() => subscribeFloatingWebcams(setFloatsOn), [])

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
    graphRef.current?.close()
    graphRef.current = null
    if (!video) return
    if (isSelf) {
      video.muted = true
      video.volume = 0
      return
    }
    const graph = openPlayback(media)
    const sink = readSinkId()
    if (!graph) {
      video.muted = muted
      video.volume = muted ? 0 : Math.min(1, gain)
      void applySink(video, sink)
      return
    }
    graphRef.current = graph
    video.muted = true
    graph.gain.gain.value = muted ? 0 : gain
    void applySink(video, sink)
    void applySink(graph.context, sink)
    const stop = subscribeSink((deviceId) => {
      void applySink(video, deviceId)
      void applySink(graph.context, deviceId)
    })
    return () => {
      stop()
      graph.close()
      if (graphRef.current === graph) graphRef.current = null
    }
  }, [media, isSelf])

  useEffect(() => {
    const video = videoRef.current
    const graph = graphRef.current
    if (isSelf) return
    if (graph) {
      if (graph.context.state === 'suspended') void graph.context.resume()
      graph.gain.gain.value = muted ? 0 : gain
      if (video) video.muted = true
      return
    }
    if (!video) return
    video.muted = muted
    video.volume = muted ? 0 : Math.min(1, gain)
  }, [muted, gain, isSelf, media])

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
  }, [lifted])

  useEffect(() => {
    const onChange = () => {
      const node = containerRef.current
      if (!node) return
      const tile = tileOf(node)
      const native = document.fullscreenElement === tile || document.fullscreenElement === node
      if (native) {
        nativeFullscreen.current = true
        setFullscreen(true)
        return
      }
      if (!nativeFullscreen.current) return
      nativeFullscreen.current = false
      cssCleanup.current?.()
      document.body.classList.remove('live-fullscreen')
      setFullscreen(false)
      setLifted(false)
      void window.electronAPI?.setWindowFullscreen?.(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    if (!lifted) return
    const node = containerRef.current
    if (!node) return
    let cancel = false
    document.body.classList.add('live-fullscreen')
    void (async () => {
      try {
        if (document.fullscreenElement !== node) await node.requestFullscreen()
      } catch (error) {
        console.warn('Fullscreen da página recusado.', error)
      }
      if (cancel) return
      nativeFullscreen.current = document.fullscreenElement === node
      setFullscreen(true)
      await window.electronAPI?.setWindowFullscreen?.(true)
    })()
    return () => {
      cancel = true
    }
  }, [lifted])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnd = () => {
      setFullscreen(false)
      setLifted(false)
      document.body.classList.remove('live-fullscreen')
    }
    video.addEventListener('webkitendfullscreen', onEnd)
    return () => video.removeEventListener('webkitendfullscreen', onEnd)
  }, [media])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void leaveFullscreen(videoRef.current as WebkitVideo | null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  useEffect(() => () => cssCleanup.current?.(), [])

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

  function releaseTile(): void {
    cssCleanup.current?.()
  }

  function holdTile(tile: HTMLElement, className: 'is-stage-fullscreen' | 'is-stage-pip'): void {
    releaseTile()
    const saved: Array<{ node: HTMLElement; overflow: string }> = []
    let parent = tile.parentElement
    while (parent) {
      saved.push({ node: parent, overflow: parent.style.overflow })
      parent.style.overflow = 'visible'
      parent = parent.parentElement
    }
    if (className === 'is-stage-fullscreen') document.body.style.overflow = 'hidden'
    tile.dataset.present = className === 'is-stage-fullscreen' ? 'fullscreen' : 'pip'
    document.body.classList.toggle('live-fullscreen', className === 'is-stage-fullscreen')
    cssCleanup.current = () => {
      delete tile.dataset.present
      document.body.classList.remove('live-fullscreen')
      for (const item of saved) item.node.style.overflow = item.overflow
      cssCleanup.current = null
    }
  }

  async function leaveFullscreen(video: WebkitVideo | null): Promise<void> {
    nativeFullscreen.current = false
    releaseTile()
    setFullscreen(false)
    setLifted(false)
    document.body.classList.remove('live-fullscreen')
    if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen?.()
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen()
      } catch {
        /* a página já saiu da tela cheia */
      }
    }
    await window.electronAPI?.setWindowFullscreen?.(false)
  }

  async function toggleFullscreen(): Promise<void> {
    const node = containerRef.current
    const video = videoRef.current as WebkitVideo | null
    if (!node || !video) return
    const tile = tileOf(node)
    const active =
      fullscreen ||
      lifted ||
      tile.dataset.present === 'fullscreen' ||
      document.fullscreenElement === tile ||
      document.fullscreenElement === node ||
      Boolean(video.webkitDisplayingFullscreen)
    if (active) {
      await leaveFullscreen(video)
      return
    }
    if (video.webkitSupportsFullscreen && video.webkitEnterFullscreen && document.fullscreenEnabled === false) {
      video.webkitEnterFullscreen()
      setFullscreen(true)
      return
    }
    try {
      await node.requestFullscreen()
      nativeFullscreen.current = true
      setFullscreen(true)
      document.body.classList.add('live-fullscreen')
      await window.electronAPI?.setWindowFullscreen?.(true)
    } catch (error) {
      console.warn('Fullscreen no container recusado, elevando o player.', error)
      setLifted(true)
    }
  }

  async function togglePip(): Promise<void> {
    const video = videoRef.current as WebkitVideo | null
    const node = containerRef.current
    if (!video || !node) return
    const tile = tileOf(node)
    if (document.pictureInPictureElement === video) {
      try {
        await document.exitPictureInPicture()
      } catch (error) {
        console.warn('Não foi possível sair do picture-in-picture.', error)
      }
      return
    }
    if (tile.dataset.present === 'pip') {
      releaseTile()
      setPip(false)
      return
    }
    try {
      if (document.pictureInPictureEnabled) {
        if (video.paused) await video.play()
        await video.requestPictureInPicture()
        return
      }
      if (video.webkitSetPresentationMode) {
        const next = video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture'
        video.webkitSetPresentationMode(next)
        setPip(next === 'picture-in-picture')
        return
      }
    } catch (error) {
      console.warn('Picture-in-picture recusado.', error)
    }
    holdTile(tile, 'is-stage-pip')
    setPip(true)
  }

  function resetZoom(): void {
    scaleRef.current = 1
    panRef.current = { x: 0, y: 0 }
    setZoomed(false)
    setTransform('translate(0px, 0px) scale(1)')
  }

  const player = (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-black ${lifted ? 'fixed inset-0 z-[200] h-screen w-screen' : 'h-full w-full'} ${!lifted && canvas && !zoomed ? 'stage-drag cursor-grab' : ''} ${zoomed ? 'cursor-move' : ''}`}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-hud]')) return
        resetZoom()
      }}
      onPointerDown={(event) => {
        if (inHud(event.target)) return
        if (canvas && !lifted && scaleRef.current <= 1) return
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
        if (canvas && !lifted) return
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
      {showFloats
        ? webcams.map((cam, index) => <FloatingCam key={cam.id} cam={cam} origin={{ x: 12, y: 12 + index * 108 }} />)
        : null}
      {showStats ? <StatsOverlay stats={stats} pending={!stats} facts={facts} /> : null}
      <div
        data-hud
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        className={`stage-no-drag absolute inset-x-3 bottom-4 z-30 flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-xl border border-white/10 bg-zinc-950/85 px-3 py-1.5 shadow-lg backdrop-blur-md transition-opacity duration-200 ${chrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <button
          type="button"
          title={isSelf ? 'Sua prévia fica muda para não ecoar' : muted ? 'Ativar som' : 'Silenciar'}
          aria-label={isSelf ? 'Sua prévia fica muda para não ecoar' : muted ? 'Ativar som' : 'Silenciar'}
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
          max={300}
          value={Math.round(gain * 100)}
          disabled={isSelf}
          onChange={(event) => {
            const next = clampVolume(Number(event.target.value) / 100)
            onVolume(next)
            onMuted(next === 0)
          }}
          className="w-24 disabled:opacity-40"
        />
        <span className="w-10 text-right text-[10px] tabular-nums text-ink">{Math.round(gain * 100)}%</span>
        {screenShare ? (
          <button
            type="button"
            title={floatsOn ? 'Ocultar câmeras' : 'Mostrar câmeras'}
            aria-label={floatsOn ? 'Ocultar câmeras' : 'Mostrar câmeras'}
            aria-pressed={floatsOn}
            onClick={() => writeFloatingWebcams(!floatsOn)}
            className="rounded-md p-1.5 text-ink hover:bg-white/10"
          >
            {floatsOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </button>
        ) : null}
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
            aria-expanded={infoVisible}
            onClick={() => setInfoPinned((value) => !value)}
            className="rounded-md px-1.5 py-1 text-[10px] font-bold tracking-wide text-ink hover:bg-white/10"
          >
            HD
          </button>
          {infoVisible && facts.length > 0 ? (
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
            title={details?.kind === 'Webcam' ? 'Ocultar câmera' : 'Deixar live'}
            aria-label={details?.kind === 'Webcam' ? 'Ocultar câmera' : 'Deixar live'}
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

  if (lifted) return createPortal(player, document.body)
  return player
}

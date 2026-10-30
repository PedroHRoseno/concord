import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Rnd, type HandleStyles } from 'react-rnd'
import { StreamCard, type StageEntry } from '@renderer/components/StreamCard'
import type { DesktopAudioRoute } from '@renderer/lib/audio-loopback'
import { clampTile, cornerLayout, equalGrid, placeNew, type TileBox } from '@renderer/lib/stage-layout'

interface AudioMix {
  volume: number
  muted: boolean
}

interface Tile extends TileBox {
  z: number
}

interface StageProps {
  entries: StageEntry[]
  layout: 'grid' | 'focus'
  isolateAudio: boolean
  audioRoute: DesktopAudioRoute
  onWatch: (id: string) => void
  onUnwatch: (id: string) => void
}

export interface StageHandle {
  organize: (mode: 'grid' | 'corner') => void
}

const RESIZE: HandleStyles = {
  top: { height: 8, top: 0, cursor: 'ns-resize', zIndex: 40 },
  right: { width: 8, right: 0, cursor: 'ew-resize', zIndex: 40 },
  bottom: { height: 8, bottom: 0, cursor: 'ns-resize', zIndex: 40 },
  left: { width: 8, left: 0, cursor: 'ew-resize', zIndex: 40 },
  topLeft: { width: 16, height: 16, cursor: 'nwse-resize', zIndex: 40 },
  topRight: { width: 16, height: 16, cursor: 'nesw-resize', zIndex: 40 },
  bottomLeft: { width: 16, height: 16, cursor: 'nesw-resize', zIndex: 40 },
  bottomRight: { width: 16, height: 16, cursor: 'nwse-resize', zIndex: 40 }
}

export const Stage = forwardRef<StageHandle, StageProps>(function Stage(
  { entries, layout, isolateAudio, audioRoute, onWatch, onUnwatch },
  ref
) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [mixes, setMixes] = useState<Record<string, AudioMix>>({})
  const [tiles, setTiles] = useState<Record<string, Tile>>({})
  const [stamp, setStamp] = useState(0)
  const [float, setFloat] = useState({ x: 16, y: 16 })
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<Record<string, Tile>>({})
  const rndRefs = useRef<Record<string, Rnd | null>>({})
  const entriesRef = useRef(entries)
  const sizeRef = useRef({ w: 0, h: 0 })
  const customRef = useRef(false)
  const pendingRef = useRef<'grid' | 'corner' | null>(null)
  const sizeChangedRef = useRef(false)
  const moveRef = useRef(false)
  const zRef = useRef(1)
  const relayoutRef = useRef<() => void>(() => undefined)
  entriesRef.current = entries
  const signature = entries.map((entry) => entry.id).join('|')

  useEffect(() => {
    if (focusedId && !entries.some((entry) => entry.id === focusedId)) setFocusedId(null)
  }, [entries, focusedId])

  function commit(next: Record<string, Tile>, move: boolean): void {
    tilesRef.current = next
    moveRef.current = move
    setTiles(next)
    if (move) setStamp((value) => value + 1)
  }

  relayoutRef.current = () => {
    const { w, h } = sizeRef.current
    if (w < 8 || h < 8) return
    const list = entriesRef.current
    const ids = new Set(list.map((entry) => entry.id))
    let removed = false
    for (const id of Object.keys(tilesRef.current)) {
      if (!ids.has(id)) {
        delete tilesRef.current[id]
        delete rndRefs.current[id]
        removed = true
      }
    }
    const missing = list.filter((entry) => !tilesRef.current[entry.id])
    const forced = pendingRef.current
    const sizeChanged = sizeChangedRef.current
    sizeChangedRef.current = false
    const empty = Object.keys(tilesRef.current).length === 0
    if (forced || (!customRef.current && (missing.length > 0 || removed || empty || sizeChanged))) {
      if (forced) pendingRef.current = null
      const useCorner =
        forced === 'corner' &&
        list.some((entry) => entry.meta.streamType === 'screen') &&
        list.some((entry) => entry.meta.streamType === 'webcam')
      const boxes = useCorner ? cornerLayout(list.map((entry) => entry.meta.streamType), w, h) : equalGrid(list.length, w, h)
      const next: Record<string, Tile> = {}
      list.forEach((entry, index) => {
        next[entry.id] = { ...boxes[index], z: (entry.meta.streamType === 'webcam' ? 40 : 1) + index }
      })
      zRef.current = list.length + 50
      if (forced) customRef.current = false
      commit(next, true)
      return
    }
    if (missing.length > 0) {
      const next = { ...tilesRef.current }
      for (const entry of missing) {
        next[entry.id] = { ...placeNew(Object.values(next), w, h), z: ++zRef.current }
      }
      commit(next, true)
      return
    }
    let changed = false
    const next = { ...tilesRef.current }
    for (const entry of list) {
      const current = next[entry.id]
      const clamped = clampTile(current, w, h)
      if (clamped.x !== current.x || clamped.y !== current.y || clamped.w !== current.w || clamped.h !== current.h) {
        next[entry.id] = { ...current, ...clamped }
        changed = true
      }
    }
    if (changed) commit(next, true)
    else if (removed) commit(next, false)
  }

  useImperativeHandle(ref, () => ({
    organize(mode) {
      pendingRef.current = mode
      customRef.current = false
      relayoutRef.current()
    }
  }))

  useEffect(() => {
    if (layout !== 'grid') return
    const node = canvasRef.current
    if (!node) return
    const observer = new ResizeObserver((records) => {
      const rect = records[0]?.contentRect
      if (!rect) return
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w < 8 || h < 8) return
      const previous = sizeRef.current
      sizeChangedRef.current = previous.w !== w || previous.h !== h
      sizeRef.current = { w, h }
      if (sizeChangedRef.current || pendingRef.current) relayoutRef.current()
    })
    observer.observe(node)
    relayoutRef.current()
    return () => observer.disconnect()
  }, [layout, signature])

  useLayoutEffect(() => {
    if (!moveRef.current) return
    moveRef.current = false
    for (const [id, tile] of Object.entries(tilesRef.current)) {
      const rnd = rndRefs.current[id]
      if (!rnd) continue
      rnd.updatePosition({ x: tile.x, y: tile.y })
      rnd.updateSize({ width: tile.w, height: tile.h })
    }
  }, [stamp])

  function mixOf(id: string): AudioMix {
    return mixes[id] ?? { volume: 1, muted: false }
  }

  function updateMix(id: string, patch: Partial<AudioMix>): void {
    setMixes((current) => {
      const previous = current[id] ?? { volume: 1, muted: false }
      return { ...current, [id]: { ...previous, ...patch } }
    })
  }

  function bringToFront(id: string): void {
    const tile = tilesRef.current[id]
    if (!tile || tile.z === zRef.current) return
    const next = { ...tilesRef.current, [id]: { ...tile, z: ++zRef.current } }
    tilesRef.current = next
    setTiles(next)
  }

  function remember(id: string, node?: HTMLElement): void {
    const tile = tilesRef.current[id]
    const pos = rndRefs.current[id]?.getDraggablePosition()
    if (!tile || !pos) return
    const next = {
      ...tilesRef.current,
      [id]: {
        ...tile,
        x: pos.x,
        y: pos.y,
        w: node ? node.offsetWidth : tile.w,
        h: node ? node.offsetHeight : tile.h
      }
    }
    tilesRef.current = next
    customRef.current = true
    setTiles(next)
  }

  function markGesture(active: boolean): void {
    const node = canvasRef.current
    if (!node) return
    if (active) node.setAttribute('data-gesturing', '')
    else node.removeAttribute('data-gesturing')
  }

  function card(entry: StageEntry, fill: boolean, focused: boolean, canvas: boolean) {
    const locked = isolateAudio && !entry.isSelf
    return (
      <StreamCard
        entry={entry}
        fill={fill}
        focused={focused}
        canvas={canvas}
        volume={mixOf(entry.id).volume}
        muted={locked || mixOf(entry.id).muted}
        audioRoute={audioRoute}
        onVolume={(volume) => updateMix(entry.id, { volume })}
        onMuted={(muted) => updateMix(entry.id, { muted })}
        onWatch={() => onWatch(entry.id)}
        onUnwatch={() => onUnwatch(entry.id)}
        onFocus={() => setFocusedId(entry.id)}
        onExitFocus={() => setFocusedId(null)}
      />
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center overflow-hidden px-6 text-center text-sm text-muted">
        Nenhuma live selecionada. Escolha alguém na lista ou compartilhe sua tela.
      </div>
    )
  }

  const focused = layout === 'focus' ? (entries.find((entry) => entry.id === focusedId) ?? entries[0]) : null
  const overlay =
    focused && focused.meta.streamType === 'screen'
      ? (entries.find((entry) => entry.peerId === focused.peerId && entry.meta.streamType === 'webcam') ?? null)
      : null
  const filmstrip = focused ? entries.filter((entry) => entry.id !== focused.id && entry.id !== overlay?.id) : []

  if (focused) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 p-3">
          {card(focused, true, true, false)}
          {overlay ? (
            <div
              className="absolute z-20 w-80 cursor-grab active:cursor-grabbing"
              style={{ right: float.x, bottom: float.y }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setDrag({ dx: event.clientX, dy: event.clientY })
              }}
              onPointerMove={(event) => {
                if (!drag) return
                setFloat((current) => ({
                  x: Math.max(8, current.x - (event.clientX - drag.dx)),
                  y: Math.max(8, current.y - (event.clientY - drag.dy))
                }))
                setDrag({ dx: event.clientX, dy: event.clientY })
              }}
              onPointerUp={() => setDrag(null)}
            >
              {card(overlay, false, false, false)}
            </div>
          ) : null}
        </div>
        {filmstrip.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto px-3 pb-3">
            {filmstrip.map((entry) => (
              <div key={entry.id} className="w-72 shrink-0">
                {card(entry, false, false, false)}
              </div>
            ))}
          </div>
        ) : (
          <div className="h-3 shrink-0" />
        )}
      </div>
    )
  }

  const minW = Math.min(240, Math.max(96, sizeRef.current.w))
  const minH = Math.min(135, Math.max(54, sizeRef.current.h))

  return (
    <div ref={canvasRef} className="stage-canvas relative h-full min-h-0 w-full overflow-hidden">
      {entries.map((entry) => {
        const tile = tiles[entry.id]
        if (!tile) return null
        return (
          <Rnd
            key={entry.id}
            ref={(node) => {
              rndRefs.current[entry.id] = node
            }}
            default={{ x: tile.x, y: tile.y, width: tile.w, height: tile.h }}
            bounds="parent"
            minWidth={minW}
            minHeight={minH}
            dragHandleClassName="stage-drag"
            cancel=".stage-no-drag"
            enableResizing
            resizeHandleStyles={RESIZE}
            className="stage-tile"
            style={{ zIndex: tile.z }}
            onMouseDown={() => bringToFront(entry.id)}
            onDragStart={() => {
              bringToFront(entry.id)
              markGesture(true)
            }}
            onDragStop={() => {
              remember(entry.id)
              markGesture(false)
            }}
            onResizeStart={() => {
              bringToFront(entry.id)
              markGesture(true)
            }}
            onResizeStop={(_event, _direction, element) => {
              remember(entry.id, element)
              markGesture(false)
            }}
          >
            <div className="h-full w-full">{card(entry, true, false, true)}</div>
          </Rnd>
        )
      })}
    </div>
  )
})

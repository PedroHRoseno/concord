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

export type CameraRail = 'bottom' | 'left' | 'right'

interface StageProps {
  entries: StageEntry[]
  layout: 'grid' | 'focus'
  cameraRail: CameraRail
  isolateAudio: boolean
  audioRoute: DesktopAudioRoute
  onWatch: (id: string) => void
  onUnwatch: (id: string) => void
  onLayoutChange: (layout: 'grid' | 'focus') => void
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
  { entries, layout, cameraRail, isolateAudio, audioRoute, onWatch, onUnwatch, onLayoutChange },
  ref
) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [mixes, setMixes] = useState<Record<string, AudioMix>>({})
  const [tiles, setTiles] = useState<Record<string, Tile>>({})
  const [stamp, setStamp] = useState(0)
  const canvasRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<Record<string, Tile>>({})
  const rndRefs = useRef<Record<string, Rnd | null>>({})
  const entriesRef = useRef(entries)
  const sizeRef = useRef({ w: 0, h: 0 })
  const customRef = useRef(false)
  const shrunkRef = useRef(false)
  const prevSizeRef = useRef<{ w: number; h: number } | null>(null)
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
    const oldSize = prevSizeRef.current
    sizeChangedRef.current = false
    prevSizeRef.current = null
    const empty = Object.keys(tilesRef.current).length === 0
    if (!forced && sizeChanged && oldSize && oldSize.w >= 8 && oldSize.h >= 8 && list.length > 0 && !empty) {
      if (list.length === 1 && !shrunkRef.current) {
        const box = equalGrid(1, w, h)[0]
        const current = tilesRef.current[list[0].id]
        if (box) {
          commit({ [list[0].id]: { ...box, z: current?.z ?? 10 } }, true)
          return
        }
      } else if (customRef.current) {
        const sx = w / oldSize.w
        const sy = h / oldSize.h
        const next: Record<string, Tile> = {}
        for (const entry of list) {
          const tile = tilesRef.current[entry.id]
          if (!tile) continue
          const scaled = clampTile(
            {
              x: Math.round(tile.x * sx),
              y: Math.round(tile.y * sy),
              w: Math.max(1, Math.round(tile.w * sx)),
              h: Math.max(1, Math.round(tile.h * sy))
            },
            w,
            h
          )
          next[entry.id] = { ...tile, ...scaled }
        }
        for (const entry of list) {
          if (next[entry.id]) continue
          next[entry.id] = { ...placeNew(Object.values(next), w, h), z: zInBand(entry.id, Object.values(next)) }
        }
        commit(next, true)
        return
      }
    }
    if (forced || (!customRef.current && (missing.length > 0 || removed || empty || sizeChanged))) {
      if (forced) pendingRef.current = null
      const useCorner =
        forced === 'corner' &&
        list.some((entry) => entry.meta.streamType === 'screen') &&
        list.some((entry) => entry.meta.streamType === 'webcam')
      const boxes = useCorner ? cornerLayout(list.map((entry) => entry.meta.streamType), w, h) : equalGrid(list.length, w, h)
      const next: Record<string, Tile> = {}
      list.forEach((entry, index) => {
        const band = zBand(entry.meta.streamType)
        next[entry.id] = { ...boxes[index], z: Math.min(band.max, band.min + index) }
      })
      zRef.current = Math.max(10, ...Object.values(next).map((tile) => tile.z))
      if (forced) {
        customRef.current = false
        shrunkRef.current = false
      }
      commit(next, true)
      return
    }
    if (missing.length > 0) {
      const next = { ...tilesRef.current }
      for (const entry of missing) {
        next[entry.id] = { ...placeNew(Object.values(next), w, h), z: zInBand(entry.id, Object.values(next)) }
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
      shrunkRef.current = false
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
      const changed = previous.w !== w || previous.h !== h
      sizeChangedRef.current = changed
      if (changed && previous.w >= 8 && previous.h >= 8) prevSizeRef.current = { w: previous.w, h: previous.h }
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

  function zBand(streamType: string | undefined): { min: number; max: number } {
    return streamType === 'webcam' ? { min: 30, max: 39 } : { min: 10, max: 19 }
  }

  function zInBand(id: string, taken: Tile[]): number {
    const entry = entriesRef.current.find((item) => item.id === id)
    const band = zBand(entry?.meta.streamType)
    const used = taken.filter((tile) => tile.z >= band.min && tile.z <= band.max).map((tile) => tile.z)
    const top = used.length > 0 ? Math.max(...used) : band.min - 1
    return Math.min(band.max, Math.max(band.min, top + 1))
  }

  function bringToFront(id: string): void {
    const tiles = tilesRef.current
    const tile = tiles[id]
    if (!tile) return
    const entry = entriesRef.current.find((item) => item.id === id)
    const band = zBand(entry?.meta.streamType)
    const same = Object.entries(tiles).filter(([key]) => {
      const other = entriesRef.current.find((item) => item.id === key)
      return zBand(other?.meta.streamType).min === band.min
    })
    const top = Math.max(...same.map(([, item]) => item.z))
    if (tile.z >= top && tile.z <= band.max) return
    const next = { ...tiles }
    if (top + 1 <= band.max) {
      next[id] = { ...tile, z: top + 1 }
    } else {
      const others = same.filter(([key]) => key !== id).sort((a, b) => a[1].z - b[1].z)
      others.forEach(([key, value], index) => {
        next[key] = { ...value, z: Math.min(band.max - 1, band.min + index) }
      })
      next[id] = { ...tile, z: Math.min(band.max, band.min + others.length) }
    }
    zRef.current = next[id].z
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
    if (node && sizeRef.current.w >= 8 && sizeRef.current.h >= 8 && Object.keys(next).length <= 1) {
      shrunkRef.current = node.offsetWidth < sizeRef.current.w * 0.85 || node.offsetHeight < sizeRef.current.h * 0.85
    }
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
        onFocus={() => {
          if (entry.meta.streamType === 'screen') setFocusedId(entry.id)
          onLayoutChange('focus')
        }}
        onExitFocus={() => {
          setFocusedId(null)
          onLayoutChange('grid')
        }}
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

  const screens = entries.filter((entry) => entry.meta.streamType === 'screen')
  const webcams = entries.filter((entry) => entry.meta.streamType === 'webcam')
  const main = layout === 'focus' ? (screens.find((entry) => entry.id === focusedId) ?? screens[0] ?? null) : null
  const strip = main ? [...screens.filter((entry) => entry.id !== main.id), ...webcams] : webcams

  if (layout === 'focus') {
    const horizontal = cameraRail === 'bottom'
    const rail =
      strip.length > 0 ? (
        <div
          className={
            horizontal
              ? 'flex shrink-0 gap-3 overflow-x-auto px-3 pb-3'
              : 'flex w-64 shrink-0 flex-col gap-3 overflow-y-auto p-3'
          }
        >
          {strip.map((entry) => (
            <div key={entry.id} className={horizontal ? 'aspect-video w-56 min-w-40 max-w-72 flex-1' : 'w-full shrink-0'}>
              {card(entry, false, false, false)}
            </div>
          ))}
        </div>
      ) : null
    const stagePane = (
      <div className="relative min-h-0 min-w-0 flex-1 p-3">
        {main ? (
          card(main, true, true, false)
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
            Nenhuma live em foco. As câmeras ficam na faixa.
          </div>
        )}
      </div>
    )
    return (
      <div className={`flex h-full min-h-0 overflow-hidden ${horizontal ? 'flex-col' : 'flex-row'}`}>
        {cameraRail === 'left' ? rail : null}
        {stagePane}
        {cameraRail === 'left' ? null : rail}
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

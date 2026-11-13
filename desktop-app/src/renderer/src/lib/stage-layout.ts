const PAD = 10
const GAP = 10

export interface TileBox {
  x: number
  y: number
  w: number
  h: number
}

export function equalGrid(count: number, width: number, height: number): TileBox[] {
  if (count <= 0 || width < 1 || height < 1) return []
  const cols = count <= 1 ? 1 : count === 2 ? 2 : count <= 4 ? 2 : Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const availW = width - PAD * 2 - GAP * Math.max(0, cols - 1)
  const availH = height - PAD * 2 - GAP * Math.max(0, rows - 1)
  let cellW = availW / cols
  let cellH = cellW * 9 / 16
  if (cellH * rows > availH) {
    cellH = availH / rows
    cellW = cellH * 16 / 9
  }
  const w = Math.max(1, Math.floor(cellW))
  const h = Math.max(1, Math.floor(cellH))
  const gridW = cols * w + Math.max(0, cols - 1) * GAP
  const gridH = rows * h + Math.max(0, rows - 1) * GAP
  const originX = Math.max(PAD, Math.floor((width - gridW) / 2))
  const originY = Math.max(PAD, Math.floor((height - gridH) / 2))
  const boxes: TileBox[] = []
  for (let index = 0; index < count; index += 1) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const inRow = row === rows - 1 ? count - row * cols : cols
    const rowWidth = inRow * w + Math.max(0, inRow - 1) * GAP
    const rowX = originX + Math.max(0, Math.floor((gridW - rowWidth) / 2))
    boxes.push({
      x: rowX + col * (w + GAP),
      y: originY + row * (h + GAP),
      w,
      h
    })
  }
  return boxes
}

export function cornerLayout(kinds: string[], width: number, height: number): TileBox[] {
  const boxes = equalGrid(kinds.length, width, height)
  const screens = kinds.flatMap((kind, index) => (kind === 'screen' ? [index] : []))
  const cams = kinds.flatMap((kind, index) => (kind === 'webcam' ? [index] : []))
  const screenBoxes = equalGrid(screens.length, width, height)
  screens.forEach((index, order) => {
    boxes[index] = screenBoxes[order]
  })
  const camW = Math.min(Math.max(240, Math.round(width * 0.28)), Math.max(1, width - PAD * 2))
  const camH = Math.min(Math.max(135, Math.round(camW * 9 / 16)), Math.max(1, height - PAD * 2))
  cams.forEach((index, order) => {
    boxes[index] = {
      x: Math.max(PAD, width - PAD - camW),
      y: Math.max(PAD, height - PAD - camH - order * (camH + GAP)),
      w: camW,
      h: camH
    }
  })
  return boxes
}

function overlaps(a: TileBox, b: TileBox): boolean {
  return a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y
}

export function placeNew(existing: TileBox[], width: number, height: number): TileBox {
  const w = Math.min(Math.max(240, Math.round(width * 0.46)), Math.max(1, width - PAD * 2))
  const h = Math.min(Math.max(135, Math.round((w * 9) / 16)), Math.max(1, height - PAD * 2))
  for (let y = PAD; y + h <= height - PAD + 1; y += 32) {
    for (let x = PAD; x + w <= width - PAD + 1; x += 32) {
      const box = { x, y, w, h }
      if (existing.every((item) => !overlaps(box, item))) return box
    }
  }
  return {
    x: Math.max(0, width - w - PAD),
    y: Math.max(0, height - h - PAD),
    w,
    h
  }
}

export function clampTile(tile: TileBox, width: number, height: number): TileBox {
  const w = Math.min(Math.max(80, tile.w), width)
  const h = Math.min(Math.max(45, tile.h), height)
  return {
    w,
    h,
    x: Math.min(Math.max(0, tile.x), Math.max(0, width - w)),
    y: Math.min(Math.max(0, tile.y), Math.max(0, height - h))
  }
}

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * Redimensiona um quadro arrastando uma borda ou canto, como o Rnd faz nos tiles do palco.
 * O lado oposto fica parado, o tamanho respeita o mínimo e o quadro nunca sai da área (0,0)-(width,height).
 */
export function resizeBox(
  start: TileBox,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  width: number,
  height: number,
  minW: number,
  minH: number
): TileBox {
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (edge.includes('w')) left = Math.min(Math.max(0, left + dx), right - minW)
  if (edge.includes('e')) right = Math.max(Math.min(width, right + dx), left + minW)
  if (edge.includes('n')) top = Math.min(Math.max(0, top + dy), bottom - minH)
  if (edge.includes('s')) bottom = Math.max(Math.min(height, bottom + dy), top + minH)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Tamanho inicial da webcam flutuante: cresce com o palco (tela cheia) e nunca fica menor que o antigo 160×90. */
export function defaultCamSize(stageWidth: number): { w: number; h: number } {
  const w = Math.min(360, Math.max(160, Math.round(stageWidth * 0.18)))
  return { w, h: Math.round((w * 9) / 16) }
}

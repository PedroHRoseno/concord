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
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const innerW = width - PAD * 2 - GAP * Math.max(0, cols - 1)
  const innerH = height - PAD * 2 - GAP * Math.max(0, rows - 1)
  const w = Math.max(1, Math.floor(innerW / cols))
  const h = Math.max(1, Math.floor(innerH / rows))
  const boxes: TileBox[] = []
  for (let index = 0; index < count; index += 1) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const inRow = row === rows - 1 ? count - row * cols : cols
    const rowWidth = inRow * w + Math.max(0, inRow - 1) * GAP
    const offsetX = PAD + Math.max(0, Math.floor((width - PAD * 2 - rowWidth) / 2))
    boxes.push({
      x: offsetX + col * (w + GAP),
      y: PAD + row * (h + GAP),
      w,
      h
    })
  }
  return boxes
}

export function cornerLayout(kinds: Array<'screen' | 'webcam'>, width: number, height: number): TileBox[] {
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

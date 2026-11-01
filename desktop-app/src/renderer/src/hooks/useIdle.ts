import { useCallback, useEffect, useRef, useState } from 'react'

export const IDLE_MS = 2500

interface Activity {
  /** true enquanto houve atividade recente do usuário. */
  active: boolean
  /** Registra atividade; com coordenadas, ignora o pointermove sintético que o layout dispara sem o mouse mover. */
  ping: (x?: number, y?: number) => void
  /** Esconde na hora (ex.: o mouse saiu do player). */
  hide: () => void
}

/** Estado "ativo/ocioso" com timer. Só o movimento real do mouse, clique, tecla ou toque reinicia a contagem. */
export function useActivity(timeout = IDLE_MS, enabled = true, startActive = true): Activity {
  const [active, setActive] = useState(startActive)
  const timer = useRef(0)
  const last = useRef<{ x: number; y: number } | null>(null)

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setActive(false)
  }, [])

  const arm = useCallback(() => {
    window.clearTimeout(timer.current)
    setActive(true)
    timer.current = window.setTimeout(() => setActive(false), timeout)
  }, [timeout])

  const ping = useCallback(
    (x?: number, y?: number) => {
      if (x !== undefined && y !== undefined) {
        const previous = last.current
        last.current = { x, y }
        if (previous && Math.abs(previous.x - x) < 1 && Math.abs(previous.y - y) < 1) return
      }
      arm()
    },
    [arm]
  )

  useEffect(() => {
    if (!enabled) {
      window.clearTimeout(timer.current)
      setActive(true)
      return
    }
    if (startActive) arm()
    return () => window.clearTimeout(timer.current)
  }, [enabled, arm, startActive])

  return { active, ping, hide }
}

/** Ociosidade da janela inteira: movimento do mouse, clique, tecla, scroll ou toque em qualquer lugar. */
export function useWindowActivity(timeout = IDLE_MS, enabled = true): boolean {
  const { active, ping } = useActivity(timeout, enabled)

  useEffect(() => {
    if (!enabled) return
    const onMove = (event: PointerEvent): void => ping(event.clientX, event.clientY)
    const onAny = (): void => ping()
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onAny, { passive: true })
    window.addEventListener('keydown', onAny)
    window.addEventListener('wheel', onAny, { passive: true })
    window.addEventListener('touchstart', onAny, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onAny)
      window.removeEventListener('keydown', onAny)
      window.removeEventListener('wheel', onAny)
      window.removeEventListener('touchstart', onAny)
    }
  }, [enabled, ping])

  return enabled ? active : true
}

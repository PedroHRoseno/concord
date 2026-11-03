import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 820px)'

interface KeepAwakePlugin {
  keepAwake?: () => Promise<void>
  allowSleep?: () => Promise<void>
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  Plugins?: { KeepAwake?: KeepAwakePlugin }
}

function capacitor(): CapacitorGlobal | undefined {
  return (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor
}

export function isElectron(): boolean {
  return Boolean(window.electronAPI)
}

export function isCapacitor(): boolean {
  return capacitor()?.isNativePlatform?.() === true
}

/** Celular nativo, ou a build web aberta numa tela estreita. O Electron nunca entra aqui. */
export function isMobile(): boolean {
  if (isElectron()) return false
  if (isCapacitor()) return true
  return window.matchMedia(MOBILE_QUERY).matches
}

export function canShareScreen(): boolean {
  return !isMobile()
}

export function hasHotkeys(): boolean {
  return isElectron()
}

export function hasUpdater(): boolean {
  return Boolean(window.electronAPI?.checkForUpdates)
}

export function hasWindowControls(): boolean {
  return Boolean(window.electronAPI?.minimize)
}

export function useMobileLayout(): boolean {
  const [mobile, setMobile] = useState(isMobile)
  useEffect(() => {
    if (isElectron() || isCapacitor()) return
    const query = window.matchMedia(MOBILE_QUERY)
    const apply = (): void => setMobile(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])
  return mobile
}

/** Mantém a tela ligada na sala. Se o WebView recusar, tenta o plugin de keep-awake quando ele existir. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !isMobile()) return
    let released = false
    let sentinel: WakeLockSentinel | null = null
    const acquire = async (): Promise<void> => {
      if (released || document.visibilityState === 'hidden') return
      try {
        sentinel = await navigator.wakeLock.request('screen')
        return
      } catch {
        /* o WebView pode recusar o Wake Lock */
      }
      try {
        await capacitor()?.Plugins?.KeepAwake?.keepAwake?.()
      } catch {
        /* a tela pode apagar; a sala continua */
      }
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => undefined)
      void capacitor()?.Plugins?.KeepAwake?.allowSleep?.().catch(() => undefined)
    }
  }, [active])
}

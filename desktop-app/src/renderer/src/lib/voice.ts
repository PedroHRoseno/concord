import { useSyncExternalStore } from 'react'
import { applySink, readSinkId, subscribeSink } from '@renderer/lib/playback'
import { pumpSuppressor } from '@renderer/lib/suppressor'

const PREFS_KEY = 'concord.voice.prefs'
const INPUT_KEY = 'concord.voice.input'
const MAX_GAIN = 2
const ON_LEVEL = 0.02
const OFF_LEVEL = 0.012
const HOLD_MS = 300
const TICK_MS = 50

export const VOICE_BITRATE = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 64_000 : 96_000

interface PeerPrefs {
  volume: number
  muted: boolean
}

interface Meter {
  analyser: AnalyserNode
  data: Float32Array<ArrayBuffer>
  speaking: boolean
  lastLoud: number
}

interface RemoteVoice {
  peerId: string
  name: string
  source: MediaStreamAudioSourceNode
  gain: GainNode
  meter: Meter
  element: HTMLAudioElement
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let deafened = false
let timer: number | null = null
let sinkUnsubscribe: (() => void) | null = null

const remotes = new Map<string, RemoteVoice>()
let local: { peerId: string; source: MediaStreamAudioSourceNode; meter: Meter } | null = null

const speaking = new Set<string>()
const speakingListeners = new Set<() => void>()
const prefsListeners = new Set<() => void>()
const levelListeners = new Set<() => void>()
let prefsVersion = 0
let micLevel = 0

function readAllPrefs(): Record<string, PeerPrefs> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, PeerPrefs>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAllPrefs(prefs: Record<string, PeerPrefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* as preferências valem nesta sessão */
  }
}

export function getPeerPrefs(name: string): PeerPrefs {
  const stored = readAllPrefs()[name]
  const volume = typeof stored?.volume === 'number' && Number.isFinite(stored.volume) ? stored.volume : 1
  return { volume: Math.min(MAX_GAIN, Math.max(0, volume)), muted: stored?.muted === true }
}

function applyPeerGain(remote: RemoteVoice): void {
  const prefs = getPeerPrefs(remote.name)
  remote.gain.gain.value = prefs.muted ? 0 : prefs.volume
}

function notifyPrefs(): void {
  prefsVersion += 1
  for (const listener of prefsListeners) listener()
}

export function setPeerVolume(name: string, volume: number): void {
  const all = readAllPrefs()
  const current = getPeerPrefs(name)
  all[name] = { ...current, volume: Math.min(MAX_GAIN, Math.max(0, volume)) }
  writeAllPrefs(all)
  for (const remote of remotes.values()) if (remote.name === name) applyPeerGain(remote)
  notifyPrefs()
}

export function setPeerMuted(name: string, muted: boolean): void {
  const all = readAllPrefs()
  all[name] = { ...getPeerPrefs(name), muted }
  writeAllPrefs(all)
  for (const remote of remotes.values()) if (remote.name === name) applyPeerGain(remote)
  notifyPrefs()
}

export function usePeerPrefs(name: string): PeerPrefs {
  useSyncExternalStore(
    (listener) => {
      prefsListeners.add(listener)
      return () => prefsListeners.delete(listener)
    },
    () => prefsVersion
  )
  return getPeerPrefs(name)
}

function setSpeaking(key: string, value: boolean): void {
  if (value === speaking.has(key)) return
  if (value) speaking.add(key)
  else speaking.delete(key)
  for (const listener of speakingListeners) listener()
}

export function useSpeaking(peerId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      speakingListeners.add(listener)
      return () => speakingListeners.delete(listener)
    },
    () => speaking.has(peerId)
  )
}

function publishLevel(rms: number): void {
  const next = Math.min(1, rms * 14)
  if (Math.abs(next - micLevel) < 0.02) return
  micLevel = next
  for (const listener of levelListeners) listener()
}

export function useMicLevel(): number {
  return useSyncExternalStore(
    (listener) => {
      levelListeners.add(listener)
      return () => levelListeners.delete(listener)
    },
    () => micLevel
  )
}

function audioContext(): AudioContext {
  if (ctx && ctx.state !== 'closed') {
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }
  ctx = new AudioContext({ latencyHint: 'interactive' })
  master = ctx.createGain()
  master.gain.value = deafened ? 0 : 1
  master.connect(ctx.destination)
  void applySink(ctx, readSinkId())
  sinkUnsubscribe?.()
  sinkUnsubscribe = subscribeSink((deviceId) => {
    if (ctx) void applySink(ctx, deviceId)
  })
  void ctx.resume()
  return ctx
}

function makeMeter(context: AudioContext): Meter {
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.2
  return { analyser, data: new Float32Array(analyser.fftSize), speaking: false, lastLoud: 0 }
}

function sample(meter: Meter, key: string, now: number, silenced: boolean): void {
  meter.analyser.getFloatTimeDomainData(meter.data)
  let sum = 0
  for (let i = 0; i < meter.data.length; i++) sum += meter.data[i] * meter.data[i]
  const rms = Math.sqrt(sum / meter.data.length)
  if (local && key === local.peerId) publishLevel(rms)
  const threshold = meter.speaking ? OFF_LEVEL : ON_LEVEL
  if (!silenced && rms > threshold) meter.lastLoud = now
  const active = !silenced && now - meter.lastLoud < HOLD_MS
  if (active !== meter.speaking) {
    meter.speaking = active
    setSpeaking(key, active)
  }
}

function tick(): void {
  const now = performance.now()
  pumpSuppressor()
  if (local) sample(local.meter, local.peerId, now, false)
  for (const remote of remotes.values()) sample(remote.meter, remote.peerId, now, false)
}

function ensureTimer(): void {
  if (timer !== null) return
  timer = window.setInterval(tick, TICK_MS)
}

function stopTimerIfIdle(): void {
  if (timer === null || local || remotes.size > 0) return
  window.clearInterval(timer)
  timer = null
}

export function readInputDeviceId(): string {
  try {
    return localStorage.getItem(INPUT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeInputDeviceId(deviceId: string): void {
  try {
    localStorage.setItem(INPUT_KEY, deviceId)
  } catch {
    /* a escolha vale nesta sessão */
  }
}

export async function listInputDevices(): Promise<Array<{ deviceId: string; label: string }>> {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    probe.getTracks().forEach((track) => track.stop())
  } catch {
    /* a lista segue com os nomes que o sistema já autorizou */
  }
  const listed = await navigator.mediaDevices.enumerateDevices()
  return listed
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Microfone ${index + 1}` }))
}

/** Mede o microfone local (anel verde) sem ligá-lo à saída, para não gerar eco. */
export function attachLocalMeter(peerId: string, stream: MediaStream): void {
  detachLocalMeter()
  const context = audioContext()
  const source = context.createMediaStreamSource(stream)
  const meter = makeMeter(context)
  source.connect(meter.analyser)
  local = { peerId, source, meter }
  ensureTimer()
}

export function detachLocalMeter(): void {
  if (!local) return
  local.source.disconnect()
  local.meter.analyser.disconnect()
  setSpeaking(local.peerId, false)
  local = null
  publishLevel(0)
  stopTimerIfIdle()
}

/**
 * O áudio recebido só entra neste grafo e vai para `destination`.
 * Ele nunca é ligado a um MediaStreamAudioDestinationNode, então não volta para nenhuma transmissão.
 */
export function attachRemoteVoice(peerId: string, name: string, stream: MediaStream): void {
  detachRemoteVoice(peerId)
  if (stream.getAudioTracks().length === 0) return
  const context = audioContext()
  const source = context.createMediaStreamSource(stream)
  const gain = context.createGain()
  const meter = makeMeter(context)
  source.connect(gain)
  gain.connect(meter.analyser)
  gain.connect(master as GainNode)
  // Contorno do bug do Chromium: áudio WebRTC só flui no AudioContext se também estiver em um elemento de mídia.
  const element = document.createElement('audio')
  element.muted = true
  element.autoplay = true
  element.style.display = 'none'
  element.srcObject = stream
  document.body.appendChild(element)
  void element.play().catch(() => undefined)
  const remote: RemoteVoice = { peerId, name, source, gain, meter, element }
  applyPeerGain(remote)
  remotes.set(peerId, remote)
  ensureTimer()
}

export function renameRemoteVoice(peerId: string, name: string): void {
  const remote = remotes.get(peerId)
  if (!remote || remote.name === name) return
  remote.name = name
  applyPeerGain(remote)
}

export function detachRemoteVoice(peerId: string): void {
  const remote = remotes.get(peerId)
  if (!remote) return
  remotes.delete(peerId)
  remote.source.disconnect()
  remote.gain.disconnect()
  remote.meter.analyser.disconnect()
  remote.element.srcObject = null
  remote.element.remove()
  setSpeaking(peerId, false)
  stopTimerIfIdle()
}

export function detachAllRemoteVoices(): void {
  for (const peerId of [...remotes.keys()]) detachRemoteVoice(peerId)
}

export function setDeafened(value: boolean): void {
  deafened = value
  if (master) master.gain.value = value ? 0 : 1
}

export function closeVoice(): void {
  detachLocalMeter()
  detachAllRemoteVoices()
  sinkUnsubscribe?.()
  sinkUnsubscribe = null
  if (ctx) void ctx.close()
  ctx = null
  master = null
  deafened = false
  speaking.clear()
  for (const listener of speakingListeners) listener()
}

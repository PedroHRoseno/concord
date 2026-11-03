import { useSyncExternalStore } from 'react'
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor'
import workletSource from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?raw'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
const MODE_KEY = 'concord.voice.suppressor'
const INPUT_KEY = 'concord.voice.input'
const FALLBACK_KEY = 'concord.voice.suppressor.fallback'
const SENSITIVITY_KEY = 'concord.voice.sensitivity'
const AUTO_KEY = 'concord.voice.sensitivity.auto'
const INPUT_GAIN_KEY = 'concord.voice.inputGain'

export type SuppressorMode = 'rnnoise' | 'browser' | 'off'

interface Graph {
  mode: SuppressorMode
  output: MediaStream
  ownsOutput: boolean
  degraded: boolean
  source: MediaStreamAudioSourceNode | null
  destination: MediaStreamAudioDestinationNode | null
  rnnoise: RnnoiseWorkletNode | null
  gate: GainNode | null
  inputGain: GainNode | null
  analyser: AnalyserNode | null
  data: Float32Array<ArrayBuffer> | null
  postAnalyser: AnalyserNode | null
  postData: Float32Array<ArrayBuffer> | null
  open: boolean
  extras: AudioNode[]
}

export interface VoiceProbe {
  preRms: number
  postRms: number
  transmitting: boolean
}

let version = 0
let degraded = false
let published = false
let releasing = false
let raw: MediaStream | null = null
let graph: Graph | null = null
let openedDevice = ''
let openedProfile: 'browser' | 'clean' = 'clean'
let buildToken = 0
let captureContext: AudioContext | null = null
let workletContext: AudioContext | null = null
let workletReady: Promise<void> | null = null
let wasmBinary: ArrayBuffer | null = null
let onEnded: (() => void) | null = null
let noiseFloor = 0.008
let lastAutoWrite = 0
let probe: VoiceProbe = { preRms: 0, postRms: 0, transmitting: false }

const listeners = new Set<() => void>()

function notify(): void {
  version += 1
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readSuppressorMode(): SuppressorMode {
  try {
    const value = localStorage.getItem(MODE_KEY)
    if (value === 'browser' || value === 'off' || value === 'rnnoise') return value
  } catch {
    /* o padrão RNNoise continua valendo */
  }
  return 'rnnoise'
}

export function readFallbackMode(): 'browser' | 'off' {
  try {
    return localStorage.getItem(FALLBACK_KEY) === 'browser' ? 'browser' : 'off'
  } catch {
    return 'off'
  }
}

export function writeSuppressorMode(mode: SuppressorMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
    if (mode === 'browser' || mode === 'off') localStorage.setItem(FALLBACK_KEY, mode)
  } catch {
    /* a escolha vale nesta sessão */
  }
  notify()
}

export function toggledSuppressorMode(): SuppressorMode {
  return readSuppressorMode() === 'rnnoise' ? readFallbackMode() : 'rnnoise'
}

export function readSensitivity(): number {
  try {
    const value = Number(localStorage.getItem(SENSITIVITY_KEY))
    if (Number.isFinite(value)) return Math.min(100, Math.max(0, Math.round(value)))
  } catch {
    /* a sensibilidade padrão continua valendo */
  }
  return 20
}

export function writeSensitivity(value: number): void {
  try {
    localStorage.setItem(SENSITIVITY_KEY, String(Math.min(100, Math.max(0, Math.round(value)))))
  } catch {
    /* a escolha vale nesta sessão */
  }
  notify()
}

export function readAutoSensitivity(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1'
  } catch {
    return false
  }
}

export function writeAutoSensitivity(value: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, value ? '1' : '0')
  } catch {
    /* a escolha vale nesta sessão */
  }
  notify()
}

export function readInputGain(): number {
  try {
    const value = Number(localStorage.getItem(INPUT_GAIN_KEY))
    if (Number.isFinite(value)) return Math.min(2, Math.max(0, value))
  } catch {
    /* o ganho padrão continua valendo */
  }
  return 1
}

export function writeInputGain(value: number): void {
  const next = Math.min(2, Math.max(0, value))
  try {
    localStorage.setItem(INPUT_GAIN_KEY, String(next))
  } catch {
    /* o ganho vale nesta sessão */
  }
  if (graph?.inputGain) graph.inputGain.gain.value = next
  notify()
}

export function readVoiceProbe(): VoiceProbe {
  return probe
}

export function voiceOutput(): MediaStream | null {
  return graph?.output ?? null
}

export function isSuppressorDegraded(): boolean {
  return degraded
}

export function isVoicePublished(): boolean {
  return published
}

export function setVoicePublished(value: boolean): void {
  published = value
}

export function setVoiceEndedHandler(handler: (() => void) | null): void {
  onEnded = handler
}

export function useVoiceProcessing(): {
  mode: SuppressorMode
  sensitivity: number
  degraded: boolean
  auto: boolean
  inputGain: number
} {
  useSyncExternalStore(subscribe, () => version)
  return {
    mode: readSuppressorMode(),
    sensitivity: readSensitivity(),
    degraded,
    auto: readAutoSensitivity(),
    inputGain: readInputGain()
  }
}

function readInputDeviceId(): string {
  try {
    return localStorage.getItem(INPUT_KEY) ?? ''
  } catch {
    return ''
  }
}

function profileFor(mode: SuppressorMode): 'browser' | 'clean' {
  return mode === 'browser' ? 'browser' : 'clean'
}

function needsNewMic(mode: SuppressorMode): boolean {
  return !raw || profileFor(mode) !== openedProfile || readInputDeviceId() !== openedDevice
}

function context(): AudioContext {
  if (captureContext && captureContext.state !== 'closed') {
    if (captureContext.state === 'suspended') void captureContext.resume()
    return captureContext
  }
  try {
    captureContext = new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 })
  } catch {
    captureContext = new AudioContext({ latencyHint: 'interactive' })
  }
  void captureContext.resume()
  return captureContext
}

async function ensureWorklet(audio: AudioContext): Promise<void> {
  if (workletContext !== audio) {
    workletContext = audio
    workletReady = null
  }
  if (!workletReady) {
    const blob = new Blob([workletSource], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    workletReady = audio.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
  }
  await workletReady
}

async function loadWasm(): Promise<ArrayBuffer> {
  if (!wasmBinary) wasmBinary = await loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdUrl })
  return wasmBinary.slice(0)
}

function setDegraded(value: boolean): void {
  if (degraded === value) return
  degraded = value
  notify()
}

function teardown(current: Graph): void {
  try {
    current.rnnoise?.destroy()
  } catch {
    /* o worklet já pode ter sido encerrado */
  }
  current.source?.disconnect()
  current.inputGain?.disconnect()
  current.gate?.disconnect()
  current.analyser?.disconnect()
  current.postAnalyser?.disconnect()
  current.destination?.disconnect()
  for (const node of current.extras) node.disconnect()
  if (current.ownsOutput) current.output.getTracks().forEach((track) => track.stop())
}

function passthrough(mic: MediaStream, mode: SuppressorMode): Graph {
  return {
    mode,
    output: mic,
    ownsOutput: false,
    degraded: mode === 'rnnoise',
    source: null,
    destination: null,
    rnnoise: null,
    gate: null,
    inputGain: null,
    analyser: null,
    data: null,
    postAnalyser: null,
    postData: null,
    open: true,
    extras: []
  }
}

function makeAnalyser(audio: AudioContext): { analyser: AnalyserNode; data: Float32Array<ArrayBuffer> } {
  const analyser = audio.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.2
  return { analyser, data: new Float32Array(analyser.fftSize) }
}

function rmsOf(analyser: AnalyserNode, data: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(data)
  let sum = 0
  for (let index = 0; index < data.length; index += 1) sum += data[index] * data[index]
  return Math.sqrt(sum / data.length)
}

function thresholdOf(sensitivity: number): number {
  return 0.004 + (sensitivity / 100) * 0.06
}

/** Estúdio: sem supressão e sem gate. O ganho de entrada continua valendo e o medidor fica no mesmo contexto. */
function studioGraph(audio: AudioContext, mic: MediaStream): Graph {
  const source = audio.createMediaStreamSource(mic)
  const inputGain = audio.createGain()
  inputGain.gain.value = readInputGain()
  const meter = makeAnalyser(audio)
  const destination = audio.createMediaStreamDestination()
  source.connect(inputGain)
  inputGain.connect(meter.analyser)
  meter.analyser.connect(destination)
  return {
    mode: 'off',
    output: destination.stream,
    ownsOutput: true,
    degraded: false,
    source,
    destination,
    rnnoise: null,
    gate: null,
    inputGain,
    analyser: meter.analyser,
    data: meter.data,
    postAnalyser: meter.analyser,
    postData: meter.data,
    open: true,
    extras: []
  }
}

function highpass(audio: AudioContext): BiquadFilterNode {
  const filter = audio.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 100
  filter.Q.value = 0.707
  return filter
}

async function buildGraph(mic: MediaStream, mode: SuppressorMode): Promise<Graph> {
  let audio: AudioContext
  try {
    audio = context()
  } catch (error) {
    console.warn('[voice] AudioContext indisponível', error)
    return passthrough(mic, mode)
  }
  if (mode === 'off') return studioGraph(audio, mic)
  const source = audio.createMediaStreamSource(mic)
  try {
    source.channelCount = 1
    source.channelCountMode = 'explicit'
  } catch {
    /* o navegador escolhe a contagem de canais */
  }
  const destination = audio.createMediaStreamDestination()
  const extras: AudioNode[] = []
  let tail: AudioNode = source
  let rnnoise: RnnoiseWorkletNode | null = null
  let usedFallback = false

  if (mode === 'rnnoise' && Math.round(audio.sampleRate) === 48_000) {
    try {
      await ensureWorklet(audio)
      rnnoise = new RnnoiseWorkletNode(audio, { maxChannels: 1, wasmBinary: await loadWasm() })
      tail.connect(rnnoise)
      tail = rnnoise
    } catch (error) {
      console.warn('[voice] RNNoise indisponível, usando high-pass e noise gate', error)
      workletReady = null
      usedFallback = true
      const filter = highpass(audio)
      tail.connect(filter)
      tail = filter
      extras.push(filter)
    }
  } else if (mode === 'rnnoise') {
    usedFallback = true
    const filter = highpass(audio)
    tail.connect(filter)
    tail = filter
    extras.push(filter)
  }

  const pre = makeAnalyser(audio)
  const post = makeAnalyser(audio)
  const inputGain = audio.createGain()
  inputGain.gain.value = readInputGain()
  const gate = audio.createGain()
  gate.gain.value = 1
  tail.connect(inputGain)
  inputGain.connect(pre.analyser)
  inputGain.connect(gate)
  gate.connect(post.analyser)
  post.analyser.connect(destination)
  const output = destination.stream
  if (output.getAudioTracks().length === 0) {
    source.disconnect()
    rnnoise?.destroy()
    return passthrough(mic, mode)
  }
  return {
    mode,
    output,
    ownsOutput: true,
    degraded: usedFallback,
    source,
    destination,
    rnnoise,
    gate,
    inputGain,
    analyser: pre.analyser,
    data: pre.data,
    postAnalyser: post.analyser,
    postData: post.data,
    open: true,
    extras
  }
}

export async function openMic(mode: SuppressorMode = readSuppressorMode()): Promise<MediaStream> {
  const deviceId = readInputDeviceId()
  const browser = mode === 'browser'
  const attempt = (exact: boolean): Promise<MediaStream> =>
    navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        deviceId: deviceId ? (exact ? { exact: deviceId } : { ideal: deviceId }) : undefined,
        echoCancellation: true,
        noiseSuppression: browser,
        autoGainControl: browser,
        channelCount: 1,
        sampleRate: 48_000
      }
    })
  try {
    return await attempt(true)
  } catch (error) {
    if (deviceId && error instanceof DOMException && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
      return attempt(false)
    }
    throw error
  }
}

async function reopenMic(mode: SuppressorMode, token: number): Promise<MediaStream | null> {
  const next = await openMic(mode)
  if (token !== buildToken) {
    next.getTracks().forEach((track) => track.stop())
    return null
  }
  const previous = raw
  raw = next
  openedDevice = readInputDeviceId()
  openedProfile = profileFor(mode)
  next.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      if (releasing || raw !== next) return
      onEnded?.()
    })
  })
  previous?.getTracks().forEach((track) => track.stop())
  return next
}

export async function rebuildVoiceOutput(): Promise<MediaStream | null> {
  const mode = readSuppressorMode()
  if (graph && raw && graph.mode === mode && !needsNewMic(mode)) return graph.output
  const token = ++buildToken
  const enabled = graph?.output.getAudioTracks()[0]?.enabled ?? true
  const wasDirect = graph ? !graph.ownsOutput : false
  let mic = raw
  if (needsNewMic(mode)) {
    mic = await reopenMic(mode, token)
    if (!mic) return null
  }
  if (!mic) return null
  const built = await buildGraph(mic, mode)
  if (token !== buildToken) {
    teardown(built)
    return null
  }
  if (wasDirect && built.ownsOutput) {
    raw?.getAudioTracks().forEach((track) => {
      track.enabled = true
    })
  }
  built.output.getAudioTracks().forEach((track) => {
    track.enabled = enabled
  })
  const previous = graph
  graph = built
  if (previous && previous !== built) teardown(previous)
  setDegraded(built.degraded)
  return built.output
}

export async function ensureVoiceOutput(): Promise<MediaStream | null> {
  const mode = readSuppressorMode()
  if (graph && raw && graph.mode === mode && !needsNewMic(mode)) return graph.output
  return rebuildVoiceOutput()
}

export function releaseVoiceCapture(): void {
  releasing = true
  buildToken += 1
  const current = graph
  graph = null
  if (current) teardown(current)
  raw?.getTracks().forEach((track) => track.stop())
  raw = null
  openedDevice = ''
  probe = { preRms: 0, postRms: 0, transmitting: false }
  setDegraded(false)
  releasing = false
}

function followNoise(preRms: number): void {
  if (!readAutoSensitivity() || readSuppressorMode() === 'off') return
  const sensitivity = readSensitivity()
  const threshold = thresholdOf(sensitivity)
  if (preRms > threshold * 1.15) return
  noiseFloor = noiseFloor * 0.92 + preRms * 0.08
  const target = Math.min(0.064, Math.max(0.004, noiseFloor * 2.2))
  const next = Math.round(((target - 0.004) / 0.06) * 100)
  if (Math.abs(next - sensitivity) < 2 || performance.now() - lastAutoWrite < 400) return
  lastAutoWrite = performance.now()
  writeSensitivity(next)
}

export function pumpSuppressor(): void {
  const current = graph
  if (!current?.analyser || !current.data) {
    probe = { preRms: 0, postRms: 0, transmitting: false }
    return
  }
  const preRms = rmsOf(current.analyser, current.data)
  const postRms = current.postAnalyser && current.postData ? rmsOf(current.postAnalyser, current.postData) : preRms
  const track = current.output.getAudioTracks()[0]
  probe = { preRms, postRms, transmitting: track ? track.enabled : true }
  const mode = readSuppressorMode()
  if (current.gate && mode !== 'off') {
    const sensitivity = readSensitivity()
    if (sensitivity <= 0) {
      current.open = true
      current.gate.gain.value = 1
    } else {
      const threshold = thresholdOf(sensitivity)
      const next = current.open ? preRms > threshold * 0.65 : preRms > threshold
      if (next !== current.open) {
        current.open = next
        const now = current.gate.context.currentTime
        current.gate.gain.cancelScheduledValues(now)
        current.gate.gain.setTargetAtTime(next ? 1 : 0, now, next ? 0.01 : 0.08)
      }
    }
  }
  followNoise(preRms)
}

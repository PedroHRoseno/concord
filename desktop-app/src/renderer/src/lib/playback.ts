const SINK_KEY = 'screenshare.audio.sink'
const FLOAT_KEY = 'screenshare.floatingWebcams'
const DISCORD_KEY = 'screenshare.discord.clientId'

type SinkListener = (deviceId: string) => void
type FloatListener = (visible: boolean) => void

const sinkListeners = new Set<SinkListener>()
const floatListeners = new Set<FloatListener>()

interface SinkTarget {
  setSinkId?: (sinkId: string) => Promise<void>
}

export interface PlaybackGraph {
  context: AudioContext
  gain: GainNode
  close: () => void
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(3, Math.max(0, value))
}

export function readSinkId(): string {
  try {
    return localStorage.getItem(SINK_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeSinkId(deviceId: string): void {
  try {
    localStorage.setItem(SINK_KEY, deviceId)
  } catch {
    /* a saída vale nesta sessão */
  }
  for (const listener of sinkListeners) listener(deviceId)
}

export function subscribeSink(listener: SinkListener): () => void {
  sinkListeners.add(listener)
  return () => sinkListeners.delete(listener)
}

export function readFloatingWebcams(): boolean {
  try {
    return localStorage.getItem(FLOAT_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeFloatingWebcams(visible: boolean): void {
  try {
    localStorage.setItem(FLOAT_KEY, visible ? '1' : '0')
  } catch {
    /* a escolha vale nesta sessão */
  }
  for (const listener of floatListeners) listener(visible)
}

export function subscribeFloatingWebcams(listener: FloatListener): () => void {
  floatListeners.add(listener)
  return () => floatListeners.delete(listener)
}

export function readDiscordClientId(): string {
  try {
    return localStorage.getItem(DISCORD_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeDiscordClientId(clientId: string): void {
  try {
    localStorage.setItem(DISCORD_KEY, clientId.trim())
  } catch {
    /* o identificador vale nesta sessão */
  }
}

export async function applySink(target: object, deviceId: string): Promise<void> {
  const sink = target as SinkTarget
  if (typeof sink.setSinkId !== 'function') return
  try {
    await sink.setSinkId(deviceId)
  } catch (error) {
    console.warn('Não foi possível trocar a saída de áudio.', error)
  }
}

export function openPlayback(stream: MediaStream): PlaybackGraph | null {
  const track = stream.getAudioTracks().find((item) => item.readyState === 'live')
  if (!track) return null
  const context = new AudioContext()
  const source = context.createMediaStreamSource(new MediaStream([track]))
  const gain = context.createGain()
  gain.gain.value = 1
  source.connect(gain)
  gain.connect(context.destination)
  void context.resume()
  return {
    context,
    gain,
    close: () => {
      source.disconnect()
      gain.disconnect()
      void context.close()
    }
  }
}

export async function listOutputDevices(): Promise<Array<{ deviceId: string; label: string }>> {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    probe.getTracks().forEach((track) => track.stop())
  } catch {
    /* a lista segue com os nomes que o sistema já autorizou */
  }
  const listed = await navigator.mediaDevices.enumerateDevices()
  return listed
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Saída ${index + 1}`
    }))
}

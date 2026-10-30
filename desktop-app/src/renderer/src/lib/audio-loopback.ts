import processorSource from './pcm-ring-processor.js?raw'

export type DesktopAudioRoute = 'process' | 'excluded' | 'system' | 'none'

interface Playback {
  context: AudioContext
  node: AudioWorkletNode
  track: MediaStreamTrack
  url: string
}

let playback: Playback | null = null
let route: DesktopAudioRoute = 'none'
let packets = 0
let peak = 0

export function audioCaptureRoute(): DesktopAudioRoute {
  return route
}

export function rememberAudioRoute(next: DesktopAudioRoute): void {
  route = next
}

function pcmFrom(bytes: Uint8Array): Int16Array {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Int16Array(copy.buffer)
}

export function stopDesktopAudio(): void {
  const current = playback
  playback = null
  route = 'none'
  packets = 0
  peak = 0
  current?.node.disconnect()
  current?.track.stop()
  void current?.context.close()
  if (current) URL.revokeObjectURL(current.url)
  void window.electronAPI?.stopAudioLoopback?.()
}

export async function attachDesktopAudio(sourceId: string): Promise<MediaStreamTrack | null> {
  stopDesktopAudio()
  const api = window.electronAPI
  if (!api?.connectAudioLoopback || !api.startAudioLoopback) return null

  const context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' })
  const blob = new Blob([processorSource], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await context.audioWorklet.addModule(url)
  } catch (error) {
    URL.revokeObjectURL(url)
    void context.close()
    console.warn('[audio] AudioWorklet não carregou', error)
    return null
  }

  const node = new AudioWorkletNode(context, 'concord-pcm-ring', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2]
  })
  const destination = context.createMediaStreamDestination()
  node.connect(destination)
  api.connectAudioLoopback((bytes) => {
    const pcm = pcmFrom(bytes)
    if (pcm.length < 1) return
    packets += 1
    for (let index = 0; index < pcm.length; index += 16) {
      const level = Math.abs(pcm[index])
      if (level > peak) peak = level
    }
    node.port.postMessage(pcm)
  })
  if (context.state !== 'running') await context.resume()

  const started = await api.startAudioLoopback(sourceId)
  const track = destination.stream.getAudioTracks()[0] ?? null
  if (!started.ok || !track) {
    node.disconnect()
    track?.stop()
    void context.close()
    URL.revokeObjectURL(url)
    void api.stopAudioLoopback()
    return null
  }

  route = started.isolated ? 'process' : 'excluded'
  playback = { context, node, track, url }
  window.setTimeout(() => {
    if (playback?.track !== track) return
    console.warn(`[audio] renderer pacotes=${packets} pico=${peak} rota=${route} taxa=${context.sampleRate}`)
  }, 1500)
  return track
}

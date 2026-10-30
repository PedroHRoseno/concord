let playback: { context: AudioContext; track: MediaStreamTrack; stopListen: () => void } | null = null

function schedulePcm(context: AudioContext, destination: MediaStreamAudioDestinationNode, pcm: Int16Array, cursor: { time: number }): void {
  const frames = Math.floor(pcm.length / 2)
  if (frames < 1) return
  const buffer = context.createBuffer(2, frames, 48_000)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  for (let index = 0; index < frames; index += 1) {
    left[index] = pcm[index * 2] / 32_768
    right[index] = pcm[index * 2 + 1] / 32_768
  }
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(destination)
  const now = context.currentTime
  if (cursor.time < now + 0.02) cursor.time = now + 0.08
  source.start(cursor.time)
  cursor.time += buffer.duration
}

export async function attachProcessAudio(sourceId: string): Promise<MediaStreamTrack | null> {
  stopProcessAudio()
  if (!window.electronAPI?.startProcessAudio) return null
  const started = await window.electronAPI.startProcessAudio(sourceId)
  if (!started) return null
  const context = new AudioContext({ sampleRate: 48_000 })
  const destination = context.createMediaStreamDestination()
  const cursor = { time: 0 }
  const stopListen = window.electronAPI.onProcessPcm((bytes) => {
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
    schedulePcm(context, destination, pcm, cursor)
  })
  void context.resume()
  const track = destination.stream.getAudioTracks()[0] ?? null
  if (!track) {
    stopListen()
    void context.close()
    void window.electronAPI.stopProcessAudio()
    return null
  }
  playback = { context, track, stopListen }
  return track
}

export function stopProcessAudio(): void {
  const current = playback
  playback = null
  current?.stopListen()
  current?.track.stop()
  void current?.context.close()
  void window.electronAPI?.stopProcessAudio()
}

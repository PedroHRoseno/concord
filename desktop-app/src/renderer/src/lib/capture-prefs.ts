import { VIDEO_BITRATES, type ResolutionPreset } from '@renderer/types'

const RESOLUTION_KEY = 'screenshare.capture.resolution'
const FPS_KEY = 'screenshare.capture.fps'
const BITRATE_KEY = 'screenshare.capture.bitrate'
const WEBCAM_KEY = 'screenshare.video.device'

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* a escolha vale nesta sessão */
  }
}

export function readCaptureResolution(): ResolutionPreset {
  const value = read(RESOLUTION_KEY)
  return value === '720p' || value === '1080p' || value === '1440p' || value === 'native' ? value : '1080p'
}

export function readCaptureFps(): 30 | 60 {
  return read(FPS_KEY) === '30' ? 30 : 60
}

export function readCaptureBitrate(): number {
  const value = Number(read(BITRATE_KEY))
  return VIDEO_BITRATES.some((item) => item.value === value) ? value : 12_000_000
}

export function writeCapturePrefs(resolution: ResolutionPreset, fps: 30 | 60, bitrate: number): void {
  write(RESOLUTION_KEY, resolution)
  write(FPS_KEY, String(fps))
  write(BITRATE_KEY, String(bitrate))
}

export function readWebcamDeviceId(): string {
  return read(WEBCAM_KEY)
}

export function writeWebcamDeviceId(deviceId: string): void {
  write(WEBCAM_KEY, deviceId)
}

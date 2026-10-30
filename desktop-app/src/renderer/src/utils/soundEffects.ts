const ENABLED_KEY = 'screenshare.sounds.enabled'
const VOLUME_KEY = 'screenshare.sounds.volume'

export interface SoundPrefs {
  enabled: boolean
  volume: number
}

let audio: AudioContext | null = null

export function readSoundPrefs(): SoundPrefs {
  let enabled = true
  let volume = 0.45
  try {
    if (localStorage.getItem(ENABLED_KEY) === '0') enabled = false
    const stored = Number(localStorage.getItem(VOLUME_KEY))
    if (Number.isFinite(stored)) volume = Math.min(1, Math.max(0, stored))
  } catch {
    /* armazenamento indisponível */
  }
  return { enabled, volume }
}

export function writeSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    /* armazenamento indisponível */
  }
}

export function writeSoundVolume(volume: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, volume))))
  } catch {
    /* armazenamento indisponível */
  }
}

function context(): AudioContext | null {
  const prefs = readSoundPrefs()
  if (!prefs.enabled || prefs.volume <= 0) return null
  if (!audio) audio = new AudioContext()
  if (audio.state === 'suspended') void audio.resume()
  return audio
}

function tone(frequency: number, delay: number, duration: number, type: OscillatorType, peak: number): void {
  const ctx = context()
  if (!ctx) return
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const start = ctx.currentTime + delay
  osc.type = type
  osc.frequency.setValueAtTime(frequency, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.03)
}

function peak(scale: number): number {
  return readSoundPrefs().volume * scale
}

export function playUserJoinSound(): void {
  tone(523, 0, 0.12, 'sine', peak(0.16))
  tone(659, 0.09, 0.16, 'sine', peak(0.14))
}

export function playUserLeaveSound(): void {
  tone(494, 0, 0.12, 'sine', peak(0.14))
  tone(392, 0.09, 0.16, 'sine', peak(0.12))
}

export function playStreamStartSound(): void {
  tone(660, 0, 0.1, 'triangle', peak(0.12))
  tone(880, 0.08, 0.16, 'triangle', peak(0.14))
}

export function playStreamStopSound(): void {
  tone(440, 0, 0.08, 'sine', peak(0.12))
  tone(330, 0.07, 0.12, 'sine', peak(0.1))
}

export function playViewerJoinedMyStreamSound(): void {
  tone(784, 0, 0.14, 'sine', peak(0.1))
}

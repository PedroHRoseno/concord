export type SettingsTarget = 'profile' | 'voice' | 'video' | 'sounds' | 'hotkeys' | 'about'

type Listener = (section: SettingsTarget) => void

let listener: Listener | null = null

export function requestSettings(section: SettingsTarget): void {
  listener?.(section)
}

export function bindSettings(next: Listener): () => void {
  listener = next
  return () => {
    if (listener === next) listener = null
  }
}

import type { PublicProfile, UserProfile } from '@renderer/types'

const PROFILE_KEY = 'screenshare.profile'
const NAME_KEY = 'screenshare.displayName'
export const AVATAR_LIMIT = 12_000
export const ACCENT_COLORS = ['#5865F2', '#ED4245', '#57F287', '#FEE75C', '#EB459E', '#F0B232']
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function emptyProfile(displayName = ''): UserProfile {
  return { displayName, avatarDataUrl: '', accentColor: '#5865F2', customStatus: '' }
}

export function sanitizeProfile(value: unknown, displayName = ''): UserProfile {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const nameSource = typeof raw.displayName === 'string' ? raw.displayName : displayName
  const avatar = typeof raw.avatarDataUrl === 'string' ? raw.avatarDataUrl : ''
  const allowed = avatar.startsWith('data:image/webp;base64,') || avatar.startsWith('data:image/svg+xml')
  const color = typeof raw.accentColor === 'string' && COLOR_RE.test(raw.accentColor) ? raw.accentColor : '#5865F2'
  const status = typeof raw.customStatus === 'string' ? raw.customStatus.trim().slice(0, 40) : ''
  return {
    displayName: nameSource.trim().slice(0, 32),
    avatarDataUrl: allowed && avatar.length <= AVATAR_LIMIT ? avatar : '',
    accentColor: color,
    customStatus: status
  }
}

export function publicProfileOf(profile: UserProfile): PublicProfile {
  const next = sanitizeProfile(profile, profile.displayName)
  return { avatarDataUrl: next.avatarDataUrl, accentColor: next.accentColor, customStatus: next.customStatus }
}

export function readProfile(): UserProfile {
  let stored: unknown = null
  let name = ''
  try {
    name = localStorage.getItem(NAME_KEY) ?? ''
    const raw = localStorage.getItem(PROFILE_KEY)
    stored = raw ? JSON.parse(raw) : null
  } catch {
    stored = null
  }
  const parsed = sanitizeProfile(stored, name)
  if (name.trim()) parsed.displayName = name.trim().slice(0, 32)
  return parsed
}

export function writeProfile(profile: UserProfile): UserProfile {
  const next = sanitizeProfile(profile, profile.displayName)
  try {
    localStorage.setItem(NAME_KEY, next.displayName)
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
  } catch {
    /* a sala segue sem gravar o perfil */
  }
  return next
}

export function cropAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 96
      const context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(url)
        reject(new Error('Não foi possível preparar a foto.'))
        return
      }
      const side = Math.min(image.width, image.height)
      const sx = (image.width - side) / 2
      const sy = (image.height - side) / 2
      context.drawImage(image, sx, sy, side, side, 0, 0, 96, 96)
      const data = canvas.toDataURL('image/webp', 0.75)
      URL.revokeObjectURL(url)
      if (data.length > AVATAR_LIMIT) reject(new Error('A foto ficou grande demais. Escolha outra.'))
      else resolve(data)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler a foto.'))
    }
    image.src = url
  })
}

export async function randomAvatar(seed: string): Promise<string> {
  const response = await fetch(`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}`)
  if (!response.ok) throw new Error('Não foi possível sortear o avatar.')
  const svg = await response.text()
  const data = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
  if (data.length > AVATAR_LIMIT) throw new Error('O avatar sorteado ficou grande demais.')
  return data
}

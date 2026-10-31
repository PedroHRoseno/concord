import { useState } from 'react'
import { Dices, ImagePlus } from 'lucide-react'
import { Avatar } from '@renderer/components/Avatar'
import { ACCENT_COLORS, cropAvatar, randomAvatar } from '@renderer/lib/profile'
import type { UserProfile } from '@renderer/types'

interface ProfileFieldsProps {
  profile: UserProfile
  onChange: (profile: UserProfile) => void
}

export function ProfileFields({ profile, onChange }: ProfileFieldsProps) {
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy(true)
    setProblem(null)
    try {
      const avatarDataUrl = await cropAvatar(file)
      onChange({ ...profile, avatarDataUrl })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Não foi possível usar a foto.')
    } finally {
      setBusy(false)
    }
  }

  async function roll(): Promise<void> {
    setBusy(true)
    setProblem(null)
    try {
      const avatarDataUrl = await randomAvatar(`${profile.displayName}-${Date.now()}`)
      onChange({ ...profile, avatarDataUrl })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Não foi possível sortear o avatar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar name={profile.displayName || '?'} src={profile.avatarDataUrl} accent={profile.accentColor} live size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-app px-3 text-xs font-semibold text-ink ring-1 ring-line">
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
            Enviar foto
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void onFile(file)
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void roll()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-app px-3 text-xs font-semibold text-ink ring-1 ring-line disabled:opacity-40"
          >
            <Dices className="h-3.5 w-3.5" aria-hidden="true" />
            Sortear avatar
          </button>
        </div>
      </div>
      {problem ? <p className="mt-2 text-xs text-danger">{problem}</p> : null}
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Cor</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ACCENT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Cor ${color}`}
            aria-pressed={profile.accentColor.toLowerCase() === color.toLowerCase()}
            onClick={() => onChange({ ...profile, accentColor: color })}
            className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-elevated ${profile.accentColor.toLowerCase() === color.toLowerCase() ? 'ring-white' : 'ring-transparent'}`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="custom-status">
        Status
      </label>
      <input
        id="custom-status"
        value={profile.customStatus}
        maxLength={40}
        placeholder="O que você está fazendo"
        onChange={(event) => onChange({ ...profile, customStatus: event.target.value })}
        className="mt-2 h-11 w-full rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
      />
    </div>
  )
}

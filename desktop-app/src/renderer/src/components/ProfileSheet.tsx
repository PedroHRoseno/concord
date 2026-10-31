import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ProfileFields } from '@renderer/components/ProfileFields'
import type { UserProfile } from '@renderer/types'

interface ProfileSheetProps {
  profile: UserProfile
  onClose: () => void
  onSave: (profile: UserProfile) => void
}

export function ProfileSheet({ profile, onClose, onSave }: ProfileSheetProps) {
  const [draft, setDraft] = useState(profile)

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        className="modal-pop w-full max-w-md rounded-2xl bg-elevated p-4 shadow-2xl ring-1 ring-white/10"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onSave(draft)
          onClose()
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Seu perfil</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-app hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="profile-name">
          Nome
        </label>
        <input
          id="profile-name"
          value={draft.displayName}
          maxLength={32}
          onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          className="mb-4 h-11 w-full rounded-lg bg-app px-3 text-sm text-ink ring-1 ring-line"
        />
        <ProfileFields profile={draft} onChange={setDraft} />
        <button type="submit" className="mt-4 h-10 w-full rounded-lg bg-blurple text-sm font-semibold text-white">
          Salvar perfil
        </button>
      </form>
    </div>,
    document.body
  )
}

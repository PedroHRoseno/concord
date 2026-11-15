import { useEffect, useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  House,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Settings2,
  Sparkles,
  UserRound,
  Video,
  Volume2
} from 'lucide-react'
import logo from '@renderer/assets/logo.png'
import { Avatar } from '@renderer/components/Avatar'
import { ProfileFields } from '@renderer/components/ProfileFields'
import { useMobileLayout } from '@renderer/lib/platform'
import { useRoomDirectory } from '@renderer/lib/room-directory'
import { readProfile, writeProfile } from '@renderer/lib/profile'
import type { LobbyInput, RoomCard, UserProfile } from '@renderer/types'

const STORAGE_NAME = 'screenshare.displayName'
const STORAGE_ROOM = 'screenshare.roomId'
const STORAGE_URL = 'screenshare.signalingUrl'
const STORAGE_TURN_URLS = 'screenshare.turn.urls'
const STORAGE_TURN_USER = 'screenshare.turn.username'
const STORAGE_TURN_CRED = 'screenshare.turn.credential'
const STORAGE_AUTO = 'screenshare.autoJoin'
const STORAGE_SIDEBAR = 'concord.lobbySidebar'
const MANUAL_DISCONNECT = 'concord.manualDisconnect'
const DEFAULT_ROOM = 'sala-principal'
const DEFAULT_SIGNALING_URL = 'wss://concord-production-c4a3.up.railway.app'
function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A sala continua utilizável se o armazenamento estiver bloqueado.
  }
}

function productionSignalingUrl(): string | null {
  const built = import.meta.env.VITE_SIGNALING_URL
  if (typeof built === 'string' && (built.startsWith('ws://') || built.startsWith('wss://'))) return built
  return null
}

function initialSignalingUrl(): string {
  const stored = readStorage(STORAGE_URL, '')
  const production = productionSignalingUrl()
  if (import.meta.env.DEV && production) return production
  if (stored.startsWith('ws://') || stored.startsWith('wss://')) return stored
  if (production) return production
  return DEFAULT_SIGNALING_URL
}

function shouldAutoJoin(): boolean {
  try {
    if (sessionStorage.getItem(MANUAL_DISCONNECT) === '1') return false
  } catch {
    return false
  }
  const saved = savedSession()
  return Boolean(saved) && readStorage(STORAGE_AUTO, '1') !== '0'
}

function savedSession(): { displayName: string; roomId: string } | null {
  const displayName = readStorage(STORAGE_NAME, '').trim()
  const roomId = readStorage(STORAGE_ROOM, '').trim()
  if (!displayName || !roomId) return null
  return { displayName, roomId }
}

interface LobbyProps {
  error: string | null
  onJoin: (input: LobbyInput) => void
  onDismissError: () => void
}

export function Lobby({ error, onJoin, onDismissError }: LobbyProps) {
  const [profile, setProfile] = useState<UserProfile>(() => readProfile())
  const [displayName, setDisplayName] = useState(() => readProfile().displayName)
  const [roomId, setRoomId] = useState(() => readStorage(STORAGE_ROOM, DEFAULT_ROOM))
  const [signalingUrl, setSignalingUrl] = useState(initialSignalingUrl)
  const [turnUrls, setTurnUrls] = useState(() => readStorage(STORAGE_TURN_URLS, ''))
  const [turnUsername, setTurnUsername] = useState(() => readStorage(STORAGE_TURN_USER, ''))
  const [turnCredential, setTurnCredential] = useState(() => readStorage(STORAGE_TURN_CRED, ''))
  const [autoJoin, setAutoJoin] = useState(() => readStorage(STORAGE_AUTO, '1') !== '0')
  const [unlisted, setUnlisted] = useState(false)
  const [view, setView] = useState<LobbyView>('home')
  const [collapsed, setCollapsed] = useState(() => readStorage(STORAGE_SIDEBAR, '') === 'collapsed')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const mobile = useMobileLayout()
  const [splash, setSplash] = useState(shouldAutoJoin)
  const rooms = useRoomDirectory(signalingUrl, !splash)

  useEffect(() => {
    if (readStorage(STORAGE_NAME, '').trim()) return
    const read = window.electronAPI?.getOsUsername
    if (!read) return
    let cancelled = false
    void read()
      .then((name) => {
        const next = name.trim().slice(0, 32)
        if (!cancelled && next) {
          setDisplayName((current) => (current.trim() ? current : next))
          setProfile((current) => (current.displayName.trim() ? current : { ...current, displayName: next }))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    onDismissError()
  }, [displayName, roomId, signalingUrl, onDismissError])

  useEffect(() => {
    if (error) setSplash(false)
  }, [error])

  useEffect(() => {
    try {
      if (sessionStorage.getItem(MANUAL_DISCONNECT) === '1') return
    } catch {
      return
    }
    const saved = savedSession()
    if (!saved || readStorage(STORAGE_AUTO, '1') === '0') return
    const storedProfile = readProfile()
    onJoin({
      displayName: saved.displayName,
      profile: { ...storedProfile, displayName: saved.displayName },
      roomId: saved.roomId,
      signalingUrl: initialSignalingUrl(),
      turn: {
        urls: readStorage(STORAGE_TURN_URLS, ''),
        username: readStorage(STORAGE_TURN_USER, ''),
        credential: readStorage(STORAGE_TURN_CRED, '')
      }
    })
  }, [onJoin])

  function toggleCollapsed(): void {
    setCollapsed((current) => {
      const next = !current
      writeStorage(STORAGE_SIDEBAR, next ? 'collapsed' : 'open')
      return next
    })
  }

  function currentInput(): LobbyInput {
    return {
      displayName,
      profile: { ...profile, displayName },
      roomId,
      signalingUrl,
      turn: { urls: turnUrls, username: turnUsername, credential: turnCredential },
      unlisted
    }
  }

  function enter(nextRoomId: string, hidden = false): void {
    const input = { ...currentInput(), roomId: nextRoomId, unlisted: hidden }
    try {
      sessionStorage.removeItem(MANUAL_DISCONNECT)
    } catch {
      /* segue o envio */
    }
    persist(input)
    onJoin(input)
  }

  function persist(input: LobbyInput): void {
    writeProfile({ ...input.profile, displayName: input.displayName })
    writeStorage(STORAGE_NAME, input.displayName)
    writeStorage(STORAGE_ROOM, input.roomId)
    writeStorage(STORAGE_URL, input.signalingUrl)
    writeStorage(STORAGE_TURN_URLS, input.turn.urls)
    writeStorage(STORAGE_TURN_USER, input.turn.username)
    writeStorage(STORAGE_TURN_CRED, input.turn.credential)
    writeStorage(STORAGE_AUTO, autoJoin ? '1' : '0')
  }

  if (splash && !error) {
    return (
      <main className="flex h-full items-center justify-center bg-app">
        <img src={logo} alt="" className="h-16 w-16 animate-pulse" />
      </main>
    )
  }

  const listed = rooms.length > 0 ? rooms : PLACEHOLDER_ROOMS
  const hero = pickHero(listed)
  const others = listed.filter((room) => room.roomId !== hero.roomId)
  const named = displayName.trim().length > 0

  function go(next: LobbyView): void {
    setView(next)
  }

  function enterOrAskName(nextRoomId: string): void {
    if (!named) {
      setView('settings')
      return
    }
    enter(nextRoomId, false)
  }

  const nav: Array<{ id: LobbyView; label: string; icon: typeof House }> = [
    { id: 'home', label: 'Início / Salas', icon: House },
    { id: 'join', label: 'Criar / Entrar por código', icon: KeyRound },
    { id: 'settings', label: 'Ajustes', icon: Settings2 }
  ]

  const errorBanner = error ? (
    <p className="mb-6 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
      {error}
    </p>
  ) : null

  const inputClass =
    'h-11 w-full rounded-xl border border-white/[0.07] bg-app px-3 text-sm text-ink transition-all duration-200 placeholder:text-muted/60 focus:border-accent/50 focus:outline-none'

  return (
    <div className="flex h-full min-h-0 bg-app">
      {mobile ? null : (
        <aside
          className={`flex shrink-0 flex-col border-r border-white/[0.07] bg-panel transition-all duration-200 ${collapsed ? 'w-[76px]' : 'w-64'}`}
        >
          <div className={`flex items-center gap-3 px-4 pb-6 pt-5 ${collapsed ? 'justify-center px-0' : ''}`}>
            <img src={logo} alt="" className="h-9 w-9 shrink-0" />
            {collapsed ? null : (
              <span className="min-w-0">
                <span className="block text-base font-bold tracking-tight text-ink">Concord</span>
                <span className="block text-xs text-muted">Tela, câmera e voz</span>
              </span>
            )}
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Lobby">
            {nav.map((item) => {
              const Icon = item.icon
              const active = view === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-all duration-200 ${collapsed ? 'justify-center px-0' : ''} ${active ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-white/[0.06] hover:text-ink'}`}
                >
                  {active ? <span className="absolute left-0 top-2 h-7 w-1 rounded-r-full bg-accent" aria-hidden="true" /> : null}
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  {collapsed ? null : <span className="truncate">{item.label}</span>}
                </button>
              )
            })}
          </nav>
          <div className="p-3">
            <div className={`flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-elevated p-2 ${collapsed ? 'flex-col' : ''}`}>
              <button
                type="button"
                onClick={() => go('settings')}
                title="Editar perfil"
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 text-left transition-all duration-200 hover:bg-white/[0.06] ${collapsed ? 'justify-center' : ''}`}
              >
                <Avatar name={displayName || '?'} src={profile.avatarDataUrl} accent={profile.accentColor} size="md" />
                {collapsed ? null : (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{displayName || 'Sem nome'}</span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-live" aria-hidden="true" />
                      <span className="truncate">{profile.customStatus || 'Disponível'}</span>
                    </span>
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => toggleCollapsed()}
                title={collapsed ? 'Expandir' : 'Recolher'}
                aria-label={collapsed ? 'Expandir a barra lateral' : 'Recolher a barra lateral'}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition-all duration-200 hover:bg-white/[0.08] hover:text-ink"
              >
                {collapsed ? <PanelLeftOpen className="h-4 w-4" aria-hidden="true" /> : <PanelLeftClose className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
          </div>
        </aside>
      )}

      <main className={`min-w-0 flex-1 overflow-y-auto ${mobile ? 'pb-24' : ''}`}>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
          {mobile ? (
            <div className="mb-5 flex items-center gap-3">
              <img src={logo} alt="" className="h-8 w-8" />
              <span className="text-lg font-bold tracking-tight text-ink">Concord</span>
              <span className="flex-1" />
              <button type="button" onClick={() => go('settings')} aria-label="Editar perfil" className="rounded-full">
                <Avatar name={displayName || '?'} src={profile.avatarDataUrl} accent={profile.accentColor} size="md" />
              </button>
            </div>
          ) : null}
          {errorBanner}

          {view === 'home' ? (
            <>
              <section className="hero-glow edge-glow relative overflow-hidden rounded-2xl border border-white/[0.07] p-6 md:p-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    {hero.members.length > 0 ? 'Mais ativa agora' : 'Em destaque'}
                  </span>
                  {hero.activity.screens.length > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-live/15 px-3 py-1 text-xs font-bold text-live">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" aria-hidden="true" />
                      {hero.activity.screens.length === 1 ? '1 live' : `${hero.activity.screens.length} lives`}
                    </span>
                  ) : null}
                  {hero.activity.cameras > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1 text-xs font-semibold text-ink">
                      <Video className="h-3.5 w-3.5" aria-hidden="true" />
                      {hero.activity.cameras === 1 ? '1 câmera' : `${hero.activity.cameras} câmeras`}
                    </span>
                  ) : null}
                </div>
                <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink md:text-4xl">{hero.label}</h1>
                <p className="mt-2 text-sm text-muted">
                  {hero.members.length === 0
                    ? 'Ninguém por aqui ainda. Seja o primeiro a chegar.'
                    : hero.members.length === 1
                      ? '1 pessoa na sala'
                      : `${hero.members.length} pessoas na sala`}
                  {hero.activity.screens[0]?.sourceName ? ` · Ao vivo: ${hero.activity.screens[0].sourceName}` : ''}
                </p>
                {hero.members.length > 0 ? (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {hero.members.slice(0, 8).map((member) => (
                      <span key={member.peerId} className="flex w-20 flex-col items-center gap-1.5" title={member.name}>
                        <Avatar name={member.name} src={member.avatar} accent={member.accentColor} speaking={member.isSpeaking} size="lg" />
                        <span className="w-full truncate text-center text-xs font-medium text-ink">{member.name}</span>
                      </span>
                    ))}
                    {hero.members.length > 8 ? (
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.08] text-sm font-semibold text-ink">
                        +{hero.members.length - 8}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => enterOrAskName(hero.roomId)}
                    className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-bold text-on-accent shadow-xl shadow-accent/20 transition-all duration-200 hover:bg-accent-strong active:scale-95"
                  >
                    Entrar Agora
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {named ? null : <span className="text-xs text-muted">Escolha um nome em Ajustes antes de entrar.</span>}
                </div>
              </section>

              <div className="mb-4 mt-10 flex items-center justify-between">
                <h2 className="text-lg font-bold text-ink">Outras salas</h2>
                <span className="inline-flex items-center gap-2 text-xs text-muted">
                  <span className="h-2 w-2 rounded-full bg-live" aria-hidden="true" />
                  {rooms.length > 0 ? 'Atualizado ao vivo' : 'Conectando ao servidor…'}
                </span>
              </div>
              {others.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/[0.07] px-4 py-8 text-center text-sm text-muted">
                  Nenhuma outra sala aberta. Crie uma em “Criar / Entrar por código”.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {others.map((room) => (
                    <RoomTile key={room.roomId} room={room} onEnter={() => enterOrAskName(room.roomId)} />
                  ))}
                </div>
              )}

              <div className="mt-10 grid gap-4 sm:grid-cols-2">
                <ShortcutCard
                  icon={UserRound}
                  title="Perfil e avatar"
                  text="Nome, foto, cor e status que os amigos veem."
                  onClick={() => go('settings')}
                />
                <ShortcutCard
                  icon={Server}
                  title="Avançado"
                  text="Servidor de sinalização e TURN manual."
                  onClick={() => {
                    setAdvancedOpen(true)
                    go('settings')
                  }}
                />
              </div>
            </>
          ) : null}

          {view === 'join' ? (
            <form
              className="mx-auto max-w-xl rounded-2xl border border-white/[0.07] bg-elevated p-6 shadow-xl shadow-black/40 md:p-8"
              onSubmit={(event) => {
                event.preventDefault()
                if (!named) {
                  setView('settings')
                  return
                }
                try {
                  sessionStorage.removeItem(MANUAL_DISCONNECT)
                } catch {
                  // Segue o envio mesmo sem conseguir limpar a sessão.
                }
                const input = currentInput()
                persist(input)
                onJoin(input)
              }}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink">Criar ou entrar por código</h1>
              <p className="mt-1 text-sm text-muted">Digite o ID da sala. Se ela não existir, será criada quando você entrar.</p>
              <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="room-id">
                ID da sala
              </label>
              <input
                id="room-id"
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
                maxLength={64}
                spellCheck={false}
                autoComplete="off"
                autoFocus
                placeholder="sala-principal"
                className={`mt-2 ${inputClass}`}
              />
              <label className="mt-4 flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={unlisted} onChange={(event) => setUnlisted(event.target.checked)} className="h-4 w-4 accent-accent" />
                Sala oculta (não listar no lobby)
              </label>
              <button
                type="submit"
                className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-sm font-bold text-on-accent shadow-xl shadow-accent/20 transition-all duration-200 hover:bg-accent-strong active:scale-95"
              >
                Entrar
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              {named ? null : <p className="mt-3 text-center text-xs text-muted">Escolha um nome em Ajustes antes de entrar.</p>}
            </form>
          ) : null}

          {view === 'settings' ? (
            <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-white/[0.07] bg-elevated p-6 shadow-xl shadow-black/40">
                <h1 className="text-xl font-bold tracking-tight text-ink">Seu perfil</h1>
                <p className="mt-1 text-sm text-muted">Aparece para todos na sala.</p>
                <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="display-name">
                  Nome de exibição
                </label>
                <input
                  id="display-name"
                  value={displayName}
                  onChange={(event) => {
                    const next = event.target.value
                    setDisplayName(next)
                    setProfile((current) => ({ ...current, displayName: next }))
                  }}
                  maxLength={32}
                  autoFocus={!named}
                  autoComplete="nickname"
                  className={`mt-2 ${inputClass}`}
                />
                <div className="mt-4">
                  <ProfileFields profile={{ ...profile, displayName }} onChange={setProfile} />
                </div>
                <button
                  type="button"
                  disabled={!named}
                  onClick={() => {
                    writeProfile({ ...profile, displayName })
                    writeStorage(STORAGE_NAME, displayName)
                    go('home')
                  }}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-accent text-sm font-bold text-on-accent transition-all duration-200 hover:bg-accent-strong active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Salvar e voltar às salas
                </button>
              </section>
              <section className="space-y-4">
                <div className="rounded-2xl border border-white/[0.07] bg-elevated p-6 shadow-xl shadow-black/40">
                  <h2 className="text-base font-semibold text-ink">Preferências</h2>
                  <label className="mt-4 flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={autoJoin}
                      onChange={(event) => {
                        const next = event.target.checked
                        setAutoJoin(next)
                        writeStorage(STORAGE_AUTO, next ? '1' : '0')
                      }}
                      className="h-4 w-4 accent-accent"
                    />
                    Entrar automaticamente na sala ao iniciar
                  </label>
                </div>
                <details
                  open={advancedOpen}
                  onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
                  className="rounded-2xl border border-white/[0.07] bg-elevated shadow-xl shadow-black/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-semibold text-ink">
                    <span className="inline-flex items-center gap-2">
                      <Server className="h-4 w-4 text-accent" aria-hidden="true" />
                      Avançado: Servidor & TURN
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted" aria-hidden="true" />
                  </summary>
                  <div className="space-y-3 px-6 pb-6">
                    <label className="block text-xs text-muted" htmlFor="signal-url">
                      URL do servidor de sinalização
                    </label>
                    <input
                      id="signal-url"
                      value={signalingUrl}
                      onChange={(event) => setSignalingUrl(event.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                      className={inputClass}
                    />
                    <label className="block text-xs text-muted" htmlFor="turn-urls">
                      URLs TURN
                    </label>
                    <input
                      id="turn-urls"
                      value={turnUrls}
                      onChange={(event) => setTurnUrls(event.target.value)}
                      spellCheck={false}
                      placeholder="turn:seu-servidor:3478"
                      className={inputClass}
                    />
                    <label className="block text-xs text-muted" htmlFor="turn-user">
                      Usuário
                    </label>
                    <input
                      id="turn-user"
                      value={turnUsername}
                      onChange={(event) => setTurnUsername(event.target.value)}
                      autoComplete="off"
                      className={inputClass}
                    />
                    <label className="block text-xs text-muted" htmlFor="turn-credential">
                      Senha
                    </label>
                    <input
                      id="turn-credential"
                      type="password"
                      value={turnCredential}
                      onChange={(event) => setTurnCredential(event.target.value)}
                      autoComplete="off"
                      className={inputClass}
                    />
                    <p className="text-xs text-muted">Vale na próxima vez que você entrar numa sala.</p>
                  </div>
                </details>
              </section>
            </div>
          ) : null}
        </div>
      </main>

      {mobile ? (
        <nav
          aria-label="Lobby"
          className="fixed inset-x-3 z-30 flex gap-1 rounded-2xl border border-white/[0.07] bg-elevated/95 p-1.5 shadow-xl shadow-black/40 backdrop-blur-md"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        >
          {nav.map((item) => {
            const Icon = item.icon
            const active = view === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-all duration-200 ${active ? 'bg-accent/15 text-accent' : 'text-muted'}`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {item.id === 'home' ? 'Salas' : item.id === 'join' ? 'Código' : 'Ajustes'}
              </button>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}

type LobbyView = 'home' | 'join' | 'settings'

const PLACEHOLDER_ROOMS: RoomCard[] = [
  { roomId: 'geral', label: 'Sala geral', members: [], activity: { screens: [], cameras: 0 } },
  { roomId: 'jogatina', label: 'Jogatina', members: [], activity: { screens: [], cameras: 0 } },
  { roomId: 'afk', label: 'AFK', members: [], activity: { screens: [], cameras: 0 } }
]

function pickHero(rooms: RoomCard[]): RoomCard {
  let best = rooms[0]
  let bestScore = -1
  for (const room of rooms) {
    const score = room.members.length * 10 + room.activity.screens.length * 3 + room.activity.cameras
    if (score > bestScore) {
      best = room
      bestScore = score
    }
  }
  return best
}

function RoomTile({ room, onEnter }: { room: RoomCard; onEnter: () => void }) {
  const live = room.activity.screens.map((screen) => screen.sourceName).filter(Boolean)
  const occupied = room.members.length > 0
  return (
    <div
      className={`group flex flex-col rounded-2xl border bg-elevated p-5 shadow-xl shadow-black/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface ${occupied ? 'border-accent/25' : 'border-white/[0.07]'}`}
    >
      <div className="flex items-start gap-3">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${occupied ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-muted'}`}>
          <Volume2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-ink">{room.label}</span>
          <span className="block text-xs text-muted">
            {room.members.length === 0 ? 'Vazia' : room.members.length === 1 ? '1 pessoa' : `${room.members.length} pessoas`}
          </span>
        </span>
      </div>
      <div className="mt-4 flex min-h-8 items-center">
        {occupied ? (
          <span className="flex -space-x-2">
            {room.members.slice(0, 5).map((member) => (
              <span key={member.peerId} className="rounded-full ring-2 ring-elevated" title={member.name}>
                <Avatar name={member.name} src={member.avatar} accent={member.accentColor} speaking={member.isSpeaking} size="sm" />
              </span>
            ))}
            {room.members.length > 5 ? (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface text-[10px] font-semibold text-ink ring-2 ring-elevated">
                +{room.members.length - 5}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-muted">Ninguém por aqui</span>
        )}
      </div>
      {live.length > 0 || room.activity.cameras > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {live.map((name) => (
            <span key={name} className="max-w-full truncate rounded-full bg-live/15 px-2.5 py-0.5 text-[11px] font-bold text-live">
              AO VIVO · {name}
            </span>
          ))}
          {room.activity.cameras > 0 ? (
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-bold text-accent">Câmera ligada</span>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onEnter}
        className="mt-5 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] text-sm font-semibold text-ink transition-all duration-200 hover:border-accent/40 hover:bg-accent hover:text-on-accent"
      >
        Entrar
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

function ShortcutCard({ icon: Icon, title, text, onClick }: { icon: typeof House; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-elevated p-4 text-left transition-all duration-200 hover:bg-surface"
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-accent">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
    </button>
  )
}

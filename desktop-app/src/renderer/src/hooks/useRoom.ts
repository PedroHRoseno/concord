import { useCallback, useEffect, useRef, useState } from 'react'
import { audioCaptureRoute, type DesktopAudioRoute } from '@renderer/lib/audio-loopback'
import {
  captureDesktop,
  captureErrorMessage,
  captureWebcam,
  isStandbyStream,
  releaseSystemAudioAnchor,
  systemAudioWarning,
  watchStandby
} from '@renderer/lib/capture'
import { alignJukebox, musicNeedsGesture, playLocal, readJukeboxSyncTime, readMusicMuted, readMusicVolume, resumeJukebox, setMusicDeafened, stopJukebox, subscribeJukebox, subscribeMusicPrefs, writeMusicMuted, writeMusicVolume } from '@renderer/lib/jukebox'
import { resolveMusicLink } from '@renderer/lib/music-link'
import { normalizeTurn } from '@renderer/lib/ice'
import { isMobile } from '@renderer/lib/platform'
import {
  ensureVoiceOutput,
  isVoicePublished,
  releaseVoiceCapture,
  rebuildVoiceOutput,
  setVoiceEndedHandler,
  setVoicePublished,
  writeSuppressorMode,
  type SuppressorMode
} from '@renderer/lib/suppressor'
import { attachLocalMeter, closeVoice, detachLocalMeter, setDeafened } from '@renderer/lib/voice'
import { publicProfileOf, readProfile, writeProfile } from '@renderer/lib/profile'
import { MeshSession } from '@renderer/lib/webrtc'
import type {
  CaptureSettings,
  ChatMessage,
  ConnectionStatus,
  LobbyInput,
  LocalPublication,
  PeerView,
  MusicState,
  PlayCue,
  RoomCard,
  ScreenGhost,
  UserProfile,
  WebcamSettings
} from '@renderer/types'

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface SelfIdentity {
  peerId: string
  displayName: string
  roomId: string
}

function createPeerId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function validateLobby(input: LobbyInput): string | null {
  const name = input.displayName.trim()
  if (name.length < 1 || name.length > 32) return 'O nome precisa ter entre 1 e 32 caracteres.'
  if (!ROOM_RE.test(input.roomId.trim())) return 'ID da sala inválido. Use letras, números, _ e -.'
  try {
    const url = new URL(input.signalingUrl.trim())
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return 'A URL do sinalizador precisa começar com ws:// ou wss://.'
    }
  } catch {
    return 'URL do sinalizador inválida.'
  }
  return null
}

function micErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'O acesso ao microfone foi bloqueado pelo sistema.'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'Nenhum microfone foi encontrado.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Não foi possível abrir o microfone.'
}

function webcamAsCapture(settings: WebcamSettings): CaptureSettings {
  return {
    sourceId: settings.deviceId || 'webcam',
    sourceName: settings.deviceLabel || 'Webcam',
    audioMode: 'none',
    audioDeviceId: '',
    resolution: isMobile() ? '720p' : settings.resolution,
    fps: 30,
    maxBitrate: isMobile() ? 2_000_000 : 4_000_000,
    audioBitrate: 128_000,
    contentHint: 'detail'
  }
}

export function useRoom() {
  const sessionRef = useRef<MeshSession | null>(null)
  const [phase, setPhase] = useState<'lobby' | 'room'>('lobby')
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [peers, setPeers] = useState<PeerView[]>([])
  const [locals, setLocals] = useState<LocalPublication[]>([])
  const [self, setSelf] = useState<SelfIdentity | null>(null)
  const [profile, setProfile] = useState<UserProfile>(() => readProfile())
  const [error, setError] = useState<string | null>(null)
  const [audioWarning, setAudioWarning] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const localsRef = useRef(locals)
  const [audioRoute, setAudioRoute] = useState<DesktopAudioRoute>('none')
  const [voiceLive, setVoiceLive] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [deafened, setDeafenedState] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [signalingUrl, setSignalingUrl] = useState('')
  const [rooms, setRooms] = useState<RoomCard[]>([])
  const [ghosts, setGhosts] = useState<ScreenGhost[]>([])
  const [latency, setLatency] = useState<number | null>(null)
  const [rosterReady, setRosterReady] = useState(false)
  const [music, setMusic] = useState<MusicState | null>(null)
  const [musicCue, setMusicCue] = useState<PlayCue | null>(null)
  const [musicBusy, setMusicBusy] = useState(false)
  const [musicBlocked, setMusicBlocked] = useState(false)
  const [musicVolume, setMusicVolumeState] = useState(readMusicVolume)
  const [musicMuted, setMusicMutedState] = useState(readMusicMuted)
  const lastInputRef = useRef<LobbyInput | null>(null)
  const micRef = useRef(false)
  const deafRef = useRef(false)
  const micBeforeDeafRef = useRef(false)
  const voiceLiveRef = useRef(false)
  const selfIdRef = useRef('')
  const musicCueRef = useRef<PlayCue | null>(null)
  const standbyStopRef = useRef<(() => void) | null>(null)

  const stopStandbyWatch = useCallback(() => {
    standbyStopRef.current?.()
    standbyStopRef.current = null
  }, [])
  const isolateAudio = audioRoute === 'system'
  localsRef.current = locals
  const musicTrackId = music?.current?.id ?? ''
  musicCueRef.current = musicCue

  useEffect(
    () =>
      subscribeMusicPrefs(() => {
        setMusicVolumeState(readMusicVolume())
        setMusicMutedState(readMusicMuted())
      }),
    []
  )

  useEffect(() => subscribeJukebox(() => setMusicBlocked(musicNeedsGesture())), [])

  useEffect(() => {
    if (!musicTrackId) setMusicCue(null)
  }, [musicTrackId])

  useEffect(() => {
    if (!musicCue) {
      stopJukebox()
      return
    }
    const trackId = musicCue.trackId
    const maestro = musicCue.addedBy === selfIdRef.current
    let cancelled = false
    void playLocal(musicCue.videoId, musicCue.currentTime, maestro ? () => {
      if (!cancelled) sessionRef.current?.musicEnded(trackId)
    } : null, (message) => {
      if (!cancelled) setError(message)
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : 'Não foi possível tocar a música.')
    })
    if (!maestro) {
      return () => {
        cancelled = true
        stopJukebox()
      }
    }
    const timer = window.setInterval(() => {
      const time = readJukeboxSyncTime()
      if (time === null) return
      sessionRef.current?.syncMusic(trackId, time)
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      stopJukebox()
    }
  }, [musicCue])

  useEffect(() => {
    return () => {
      standbyStopRef.current?.()
      standbyStopRef.current = null
      setVoiceEndedHandler(null)
      sessionRef.current?.dispose()
      sessionRef.current = null
      setVoicePublished(false)
      releaseVoiceCapture()
      closeVoice()
    }
  }, [])

  const resetVoice = useCallback(() => {
    setVoicePublished(false)
    detachLocalMeter()
    releaseVoiceCapture()
    closeVoice()
    micRef.current = false
    deafRef.current = false
    micBeforeDeafRef.current = false
    voiceLiveRef.current = false
    setVoiceLive(false)
    setMicOn(false)
    setDeafenedState(false)
  }, [])

  const applyMic = useCallback((on: boolean) => {
    micRef.current = on
    setMicOn(on)
    sessionRef.current?.setVoiceEnabled(on)
  }, [])

  const toggleMic = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    if (deafRef.current) {
      // Ligar o microfone com o fone mudo também reativa o áudio, como no Discord.
      deafRef.current = false
      setDeafenedState(false)
      setDeafened(false)
    }
    if (!voiceLiveRef.current) {
      try {
        const stream = await ensureVoiceOutput()
        if (!stream) return
        await session.publishVoice(stream)
        setVoicePublished(true)
        voiceLiveRef.current = true
        setVoiceLive(true)
        attachLocalMeter(selfIdRef.current, stream)
        applyMic(true)
      } catch (caught) {
        if (!isVoicePublished()) releaseVoiceCapture()
        setError(micErrorMessage(caught))
      }
      return
    }
    applyMic(!micRef.current)
  }, [applyMic])

  const applySuppressor = useCallback(async (mode: SuppressorMode) => {
    writeSuppressorMode(mode)
    if (!voiceLiveRef.current) return
    const session = sessionRef.current
    if (!session) return
    try {
      const stream = await rebuildVoiceOutput()
      if (!stream) return
      stream.getAudioTracks().forEach((track) => {
        track.enabled = micRef.current
      })
      await session.replaceVoiceTrack(stream)
      attachLocalMeter(selfIdRef.current, stream)
    } catch (caught) {
      setError(micErrorMessage(caught))
    }
  }, [])

  const toggleDeafen = useCallback(() => {
    const next = !deafRef.current
    deafRef.current = next
    setDeafenedState(next)
    setDeafened(next)
    setMusicDeafened(next)
    if (next) {
      micBeforeDeafRef.current = micRef.current
      if (micRef.current) applyMic(false)
    } else if (micBeforeDeafRef.current && voiceLiveRef.current) {
      applyMic(true)
    }
  }, [applyMic])

  useEffect(() => {
    setVoiceEndedHandler(() => {
      sessionRef.current?.stopStream('voice')
      setVoicePublished(false)
      detachLocalMeter()
      releaseVoiceCapture()
      voiceLiveRef.current = false
      micRef.current = false
      setVoiceLive(false)
      setMicOn(false)
    })
    return () => setVoiceEndedHandler(null)
  }, [])

  useEffect(() => {
    const stopMute = window.electronAPI?.onVoiceToggleMute?.(() => void toggleMic())
    const stopDeafen = window.electronAPI?.onVoiceToggleDeafen?.(() => toggleDeafen())
    return () => {
      stopMute?.()
      stopDeafen?.()
    }
  }, [toggleMic, toggleDeafen])

  const sendChat = useCallback((text: string, image?: string) => {
    sessionRef.current?.sendChat(text, image)
  }, [])

  const addMusic = useCallback(async (url: string) => {
    const session = sessionRef.current
    const signaling = lastInputRef.current?.signalingUrl
    if (!session || !signaling) return
    setMusicBusy(true)
    try {
      session.addMusic(await resolveMusicLink(url, signaling))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível adicionar a música.')
    } finally {
      setMusicBusy(false)
    }
  }, [])

  const voteSkip = useCallback(() => sessionRef.current?.voteSkip(), [])
  const forceSkip = useCallback(() => sessionRef.current?.forceSkip(), [])
  const setMusicVolume = useCallback((value: number) => writeMusicVolume(value), [])
  const toggleMusicMuted = useCallback(() => writeMusicMuted(!readMusicMuted()), [])
  const resumeMusic = useCallback(() => resumeJukebox(), [])

  const join = useCallback((input: LobbyInput) => {
    const problem = validateLobby(input)
    if (problem) {
      setError(problem)
      return
    }
    stopStandbyWatch()
    stopJukebox()
    setMusic(null)
    setMusicCue(null)
    sessionRef.current?.dispose()
    const peerId = createPeerId()
    const saved = writeProfile({ ...input.profile, displayName: input.displayName.trim() })
    const displayName = saved.displayName
    const roomId = input.roomId.trim()
    const session = new MeshSession({
      url: input.signalingUrl.trim(),
      roomId,
      peerId,
      displayName,
      profile: publicProfileOf(saved),
      turn: normalizeTurn(input.turn),
      unlisted: input.unlisted === true,
      events: {
        onStatus: setStatus,
        onSnapshot: (snapshot) => {
          setPeers(snapshot.peers)
          setGhosts(snapshot.ghosts)
          setRosterReady(true)
        },
        onRooms: setRooms,
        onMusic: setMusic,
        onPlayMusic: (next) => {
          setMusicCue((current) => (current?.trackId === next.trackId ? current : next))
        },
        onMusicSync: (trackId, currentTime) => {
          const current = musicCueRef.current
          if (!current || current.trackId !== trackId || current.addedBy === selfIdRef.current) return
          alignJukebox(currentTime)
        },
        onLatency: setLatency,
        onLocals: (publications) => {
          if (!publications.some((item) => item.meta.streamType === 'screen')) {
            releaseSystemAudioAnchor()
            setAudioRoute('none')
          }
          setLocals(publications)
        },
        onError: setError,
        onChat: (message) =>
          setChatMessages((current) =>
            current.some((item) => item.id === message.id) ? current : [...current, message].slice(-300)
          ),
        onChatHistory: (messages) =>
          setChatMessages((current) => {
            const known = new Set(messages.map((item) => item.id))
            return [...messages, ...current.filter((item) => !known.has(item.id))].slice(-300)
          })
      }
    })
    resetVoice()
    selfIdRef.current = peerId
    setSignalingUrl(input.signalingUrl.trim())
    setChatMessages([])
    setRosterReady(false)
    setRooms([])
    setGhosts([])
    setLatency(null)
    lastInputRef.current = { ...input, displayName, roomId, profile: saved }
    sessionRef.current = session
    setProfile(saved)
    setSelf({ peerId, displayName, roomId })
    setPeers([])
    setLocals([])
    setAudioWarning(null)
    setAudioRoute('none')
    setError(null)
    setPhase('room')
    session.start()
  }, [resetVoice, stopStandbyWatch])

  const switchRoom = useCallback(
    (roomId: string) => {
      const current = lastInputRef.current
      if (!current || current.roomId === roomId) return
      join({ ...current, roomId, unlisted: false })
    },
    [join]
  )

  const setVoiceState = useCallback((speaking: boolean, muted: boolean) => {
    sessionRef.current?.setVoiceState(speaking, muted)
  }, [])

  const leave = useCallback(() => {
    stopStandbyWatch()
    stopJukebox()
    setMusic(null)
    setMusicCue(null)
    setVoiceEndedHandler(null)
    sessionRef.current?.dispose()
    sessionRef.current = null
    resetVoice()
    setSignalingUrl('')
    setChatMessages([])
    releaseSystemAudioAnchor()
    setPhase('lobby')
    setPeers([])
    setGhosts([])
    setLatency(null)
    setLocals([])
    setSelf(null)
    setError(null)
    setAudioWarning(null)
    setAudioRoute('none')
    setStatus('disconnected')
    setBusy(false)
    try {
      sessionStorage.setItem('concord.manualDisconnect', '1')
    } catch {
      // O lobby segue visível mesmo se o navegador bloquear a sessão.
    }
  }, [resetVoice, stopStandbyWatch])

  const publish = useCallback(async (settings: CaptureSettings) => {
    const session = sessionRef.current
    if (!session) return
    setBusy(true)
    setError(null)
    let stream: MediaStream | null = null
    try {
      stopStandbyWatch()
      stream = await captureDesktop(settings)
      setAudioWarning(systemAudioWarning(stream, settings))
      setAudioRoute(audioCaptureRoute())
      await session.publish(stream, settings, 'screen')
      if (isStandbyStream(stream)) {
        standbyStopRef.current = watchStandby(settings, (next) => {
          standbyStopRef.current = null
          void session.publish(next, settings, 'screen').then(() => {
            setAudioWarning(systemAudioWarning(next, settings))
            setAudioRoute(audioCaptureRoute())
          })
        })
      }
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop())
      releaseSystemAudioAnchor()
      setAudioRoute('none')
      setError(captureErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }, [stopStandbyWatch])

  const publishWebcam = useCallback(async (settings: WebcamSettings) => {
    const session = sessionRef.current
    if (!session) return
    setBusy(true)
    setError(null)
    let stream: MediaStream | null = null
    const swapping = isMobile() && localsRef.current.some((item) => item.meta.streamType === 'webcam')
    if (swapping) {
      session.prepareCameraSwap('webcam')
      for (const publication of localsRef.current) {
        if (publication.meta.streamType === 'webcam') publication.media.getTracks().forEach((track) => track.stop())
      }
    }
    try {
      stream = await captureWebcam(settings)
      await session.publish(stream, webcamAsCapture(settings), 'webcam')
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop())
      if (swapping) session.stopStream('webcam')
      setError(captureErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }, [])

  const stopShare = useCallback((streamType: 'screen' | 'webcam' = 'screen') => {
    if (streamType === 'screen') stopStandbyWatch()
    sessionRef.current?.stopStream(streamType)
    if (streamType === 'screen') {
      releaseSystemAudioAnchor()
      setAudioWarning(null)
      setAudioRoute('none')
    }
  }, [stopStandbyWatch])

  const watch = useCallback((streamId: string) => {
    sessionRef.current?.watch(streamId)
  }, [])

  const unwatch = useCallback((streamId: string) => {
    sessionRef.current?.unwatch(streamId)
  }, [])

  const hideScreen = useCallback((streamId: string) => {
    sessionRef.current?.hideScreen(streamId)
  }, [])

  const noteFrame = useCallback((streamId: string, image: string) => {
    sessionRef.current?.noteFrame(streamId, image)
  }, [])

  const updateProfile = useCallback((next: UserProfile) => {
    const saved = writeProfile(next)
    setProfile(saved)
    setSelf((current) => (current ? { ...current, displayName: saved.displayName } : current))
    sessionRef.current?.updateProfile(saved.displayName, publicProfileOf(saved))
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  const screenLive = locals.some((item) => item.meta.streamType === 'screen')
  const webcamLive = locals.some((item) => item.meta.streamType === 'webcam')

  return {
    phase,
    status,
    peers,
    locals,
    self,
    profile,
    error,
    audioWarning,
    audioRoute,
    busy,
    isolateAudio,
    voiceLive,
    micOn,
    deafened,
    signalingUrl,
    rooms,
    ghosts,
    latency,
    rosterReady,
    switchRoom,
    setVoiceState,
    toggleMic,
    toggleDeafen,
    applySuppressor,
    chatMessages,
    sendChat,
    music,
    musicBusy,
    musicBlocked,
    musicVolume,
    musicMuted,
    addMusic,
    voteSkip,
    forceSkip,
    setMusicVolume,
    toggleMusicMuted,
    resumeMusic,
    screenLive,
    webcamLive,
    join,
    leave,
    publish,
    publishWebcam,
    stopShare,
    watch,
    unwatch,
    hideScreen,
    noteFrame,
    updateProfile,
    dismissError
  }
}

export type RoomController = ReturnType<typeof useRoom>

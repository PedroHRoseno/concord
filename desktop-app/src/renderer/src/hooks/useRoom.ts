import { useCallback, useEffect, useRef, useState } from 'react'
import { audioCaptureRoute, type DesktopAudioRoute } from '@renderer/lib/audio-loopback'
import {
  captureDesktop,
  captureErrorMessage,
  captureWebcam,
  releaseSystemAudioAnchor,
  systemAudioWarning
} from '@renderer/lib/capture'
import { normalizeTurn } from '@renderer/lib/ice'
import { isMobile } from '@renderer/lib/platform'
import { attachLocalMeter, closeVoice, detachLocalMeter, openMic, setDeafened } from '@renderer/lib/voice'
import { publicProfileOf, readProfile, writeProfile } from '@renderer/lib/profile'
import { MeshSession } from '@renderer/lib/webrtc'
import type {
  CaptureSettings,
  ChatMessage,
  ConnectionStatus,
  LobbyInput,
  LocalPublication,
  PeerView,
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
  const micRef = useRef(false)
  const deafRef = useRef(false)
  const micBeforeDeafRef = useRef(false)
  const voiceLiveRef = useRef(false)
  const selfIdRef = useRef('')
  const isolateAudio = audioRoute === 'system'
  localsRef.current = locals

  useEffect(() => {
    return () => {
      sessionRef.current?.dispose()
      sessionRef.current = null
      closeVoice()
    }
  }, [])

  const resetVoice = useCallback(() => {
    detachLocalMeter()
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
        const stream = await openMic()
        await session.publishVoice(stream)
        voiceLiveRef.current = true
        setVoiceLive(true)
        attachLocalMeter(selfIdRef.current, stream)
        applyMic(true)
      } catch (caught) {
        setError(micErrorMessage(caught))
      }
      return
    }
    applyMic(!micRef.current)
  }, [applyMic])

  const toggleDeafen = useCallback(() => {
    const next = !deafRef.current
    deafRef.current = next
    setDeafenedState(next)
    setDeafened(next)
    if (next) {
      micBeforeDeafRef.current = micRef.current
      if (micRef.current) applyMic(false)
    } else if (micBeforeDeafRef.current && voiceLiveRef.current) {
      applyMic(true)
    }
  }, [applyMic])

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

  const join = useCallback((input: LobbyInput) => {
    const problem = validateLobby(input)
    if (problem) {
      setError(problem)
      return
    }
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
      events: {
        onStatus: setStatus,
        onSnapshot: (snapshot) => setPeers(snapshot.peers),
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
    setChatMessages([])
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
  }, [resetVoice])

  const leave = useCallback(() => {
    sessionRef.current?.dispose()
    sessionRef.current = null
    resetVoice()
    setChatMessages([])
    releaseSystemAudioAnchor()
    setPhase('lobby')
    setPeers([])
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
  }, [resetVoice])

  const publish = useCallback(async (settings: CaptureSettings) => {
    const session = sessionRef.current
    if (!session) return
    setBusy(true)
    setError(null)
    let stream: MediaStream | null = null
    try {
      stream = await captureDesktop(settings)
      setAudioWarning(systemAudioWarning(stream, settings))
      setAudioRoute(audioCaptureRoute())
      await session.publish(stream, settings, 'screen')
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop())
      releaseSystemAudioAnchor()
      setAudioRoute('none')
      setError(captureErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }, [])

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
    sessionRef.current?.stopStream(streamType)
    if (streamType === 'screen') {
      releaseSystemAudioAnchor()
      setAudioWarning(null)
      setAudioRoute('none')
    }
  }, [])

  const watch = useCallback((streamId: string) => {
    sessionRef.current?.watch(streamId)
  }, [])

  const unwatch = useCallback((streamId: string) => {
    sessionRef.current?.unwatch(streamId)
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
    toggleMic,
    toggleDeafen,
    chatMessages,
    sendChat,
    screenLive,
    webcamLive,
    join,
    leave,
    publish,
    publishWebcam,
    stopShare,
    watch,
    unwatch,
    updateProfile,
    dismissError
  }
}

export type RoomController = ReturnType<typeof useRoom>

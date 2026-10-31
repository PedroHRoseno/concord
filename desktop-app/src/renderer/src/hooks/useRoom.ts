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
import { publicProfileOf, readProfile, writeProfile } from '@renderer/lib/profile'
import { MeshSession } from '@renderer/lib/webrtc'
import type {
  CaptureSettings,
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

function webcamAsCapture(settings: WebcamSettings): CaptureSettings {
  return {
    sourceId: settings.deviceId || 'webcam',
    sourceName: settings.deviceLabel || 'Webcam',
    audioMode: 'none',
    audioDeviceId: '',
    resolution: settings.resolution,
    fps: 30,
    maxBitrate: 4_000_000,
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
  const [audioRoute, setAudioRoute] = useState<DesktopAudioRoute>('none')
  const isolateAudio = audioRoute === 'system'

  useEffect(() => {
    return () => {
      sessionRef.current?.dispose()
      sessionRef.current = null
    }
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
        onError: setError
      }
    })
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
  }, [])

  const leave = useCallback(() => {
    sessionRef.current?.dispose()
    sessionRef.current = null
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
  }, [])

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
    try {
      stream = await captureWebcam(settings)
      await session.publish(stream, webcamAsCapture(settings), 'webcam')
    } catch (caught) {
      stream?.getTracks().forEach((track) => track.stop())
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

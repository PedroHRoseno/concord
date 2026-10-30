export function tuneOpus(sdp: string, maxAverageBitrate: number): string {
  const match = /a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?/i.exec(sdp)
  if (!match) return sdp
  const payloadType = match[1]
  const line = `a=fmtp:${payloadType} minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=${maxAverageBitrate};usedtx=0`
  const fmtp = new RegExp(`a=fmtp:${payloadType}[^\\r\\n]*`)
  if (fmtp.test(sdp)) return sdp.replace(fmtp, line)
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n'
  return sdp.replace(match[0], `${match[0]}${eol}${line}`)
}

function primaryRank(mimeType: string): number {
  switch (mimeType.toLowerCase()) {
    case 'video/h264':
      return 0
    case 'video/vp9':
      return 1
    case 'video/av1':
      return 2
    case 'video/vp8':
      return 3
    default:
      return 6
  }
}

function codecPayload(codec: RTCRtpCodec): number | undefined {
  const extra = codec as RTCRtpCodec & { payloadType?: number; preferredPayloadType?: number }
  return extra.payloadType ?? extra.preferredPayloadType
}

export function orderVideoCodecs(codecs: RTCRtpCodec[]): RTCRtpCodec[] {
  const score = (codec: RTCRtpCodec): number => {
    const mime = codec.mimeType.toLowerCase()
    if (mime === 'video/rtx' || mime === 'video/red' || mime === 'video/ulpfec' || mime === 'video/flexfec-03') {
      const apt = codec.sdpFmtpLine?.match(/apt=(\d+)/)?.[1]
      const primary = codecs.find((item) => String(codecPayload(item)) === apt)
      return primary ? primaryRank(primary.mimeType) + 0.1 : 5
    }
    return primaryRank(mime)
  }
  return [...codecs].sort((a, b) => score(a) - score(b))
}

export function preferVideoCodecs(transceiver: RTCRtpTransceiver): void {
  const caps = RTCRtpSender.getCapabilities('video')
  if (!caps) return
  try {
    transceiver.setCodecPreferences(orderVideoCodecs(caps.codecs))
  } catch (error) {
    console.warn('Preferência de codec de vídeo ignorada.', error)
  }
}

export function preferOpus(transceiver: RTCRtpTransceiver): void {
  const caps = RTCRtpSender.getCapabilities('audio')
  if (!caps) return
  const codecs = [...caps.codecs].sort((a, b) => {
    const aOpus = a.mimeType.toLowerCase() === 'audio/opus' ? 0 : 1
    const bOpus = b.mimeType.toLowerCase() === 'audio/opus' ? 0 : 1
    return aOpus - bOpus
  })
  try {
    transceiver.setCodecPreferences(codecs)
  } catch (error) {
    console.warn('Preferência de Opus ignorada.', error)
  }
}

export async function applyVideoEncoding(
  sender: RTCRtpSender,
  maxBitrate: number,
  maxFramerate: number,
  contentHint: 'motion' | 'detail'
): Promise<void> {
  const params = sender.getParameters()
  if (!params.encodings || params.encodings.length === 0) {
    params.encodings = [{}]
  }
  const encoding = params.encodings[0]
  encoding.maxBitrate = maxBitrate
  encoding.maxFramerate = maxFramerate
  encoding.priority = 'high'
  params.degradationPreference = contentHint === 'motion' ? 'maintain-framerate' : 'maintain-resolution'
  await sender.setParameters(params)
}
